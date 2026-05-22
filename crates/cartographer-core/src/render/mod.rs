//! SVG rendering from a [`Map`].

pub mod raster;

use crate::geometry;
use crate::model::{BackgroundStyle, FloorStyle, Layer, Map, MapObject};
use crate::symbols;
use geo::MultiPolygon;
use std::fmt::Write as _;

#[derive(Debug, Clone)]
pub struct RenderOptions {
    /// Padding (in cells) around the bounding box.
    pub padding_cells: f64,
    /// Whether to draw the grid overlay on the floor.
    pub show_grid: bool,
}

impl Default for RenderOptions {
    fn default() -> Self {
        Self { padding_cells: 2.0, show_grid: true }
    }
}

/// Render a [`Map`] to a complete SVG document string.
pub fn render_svg(map: &Map, opts: &RenderOptions) -> String {
    let cell_px = map.grid.cell_size as f64;

    let (min_cx, min_cy, max_cx, max_cy) = layers_bounds(map).unwrap_or((0.0, 0.0, 10.0, 10.0));
    let pad = opts.padding_cells;
    let vb_x = (min_cx - pad) * cell_px;
    let vb_y = (min_cy - pad) * cell_px;
    let vb_w = (max_cx - min_cx + pad * 2.0) * cell_px;
    let vb_h = (max_cy - min_cy + pad * 2.0) * cell_px;

    let theme = theme_for(map.background.style);
    let mut s = String::with_capacity(8192);

    let _ = write!(
        s,
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="{vb_w:.0}" height="{vb_h:.0}" viewBox="{vb_x:.2} {vb_y:.2} {vb_w:.2} {vb_h:.2}">"#
    );

    // Background
    let _ = write!(
        s,
        r#"<rect x="{vb_x:.2}" y="{vb_y:.2}" width="{vb_w:.2}" height="{vb_h:.2}" fill="{}"/>"#,
        theme.background
    );

    // Layers (currently only the first is rendered; multi-layer in a later phase)
    for layer in &map.layers {
        render_layer(&mut s, layer, cell_px, &theme, opts);
    }

    // Notes
    for note in &map.notes {
        let cx = (note.at[0] as f64 + 0.5) * cell_px;
        let cy = (note.at[1] as f64 + 0.5) * cell_px;
        let _ = write!(
            s,
            r#"<text x="{cx:.2}" y="{cy:.2}" text-anchor="middle" font-family="Georgia, serif" font-size="{}" fill="{}">{}</text>"#,
            (cell_px * 0.3),
            theme.note_color,
            xml_escape(&note.text),
        );
    }

    s.push_str("</svg>");
    s
}

fn layers_bounds(map: &Map) -> Option<(f64, f64, f64, f64)> {
    let mut acc: Option<(f64, f64, f64, f64)> = None;
    for layer in &map.layers {
        if let Some(b) = geometry::layer_bounds(layer) {
            acc = Some(match acc {
                None => b,
                Some(a) => (a.0.min(b.0), a.1.min(b.1), a.2.max(b.2), a.3.max(b.3)),
            });
        }
    }
    acc
}

fn render_layer(s: &mut String, layer: &Layer, cell_px: f64, theme: &Theme, opts: &RenderOptions) {
    let floor = geometry::layer_floor(layer);
    if floor.0.is_empty() {
        return;
    }
    let floor_d = multipolygon_to_path_d(&floor, cell_px);

    // Floor fill
    let _ = write!(
        s,
        r#"<path d="{floor_d}" fill="{}" fill-rule="evenodd"/>"#,
        theme.floor
    );

    // Floor pattern overlay (hatching/dots), clipped to floor shape via a clipPath
    if matches!(layer.style.floor, FloorStyle::Hatched) && theme.hatch.is_some() {
        let clip_id = format!("clip-{}", layer.id);
        let _ = write!(
            s,
            r#"<clipPath id="{clip_id}"><path d="{floor_d}" fill-rule="evenodd"/></clipPath>"#
        );
        write_hatch(s, &floor, cell_px, &clip_id, theme.hatch.unwrap());
    }

    // Grid overlay
    if opts.show_grid {
        let clip_id = format!("grid-clip-{}", layer.id);
        let _ = write!(
            s,
            r#"<clipPath id="{clip_id}"><path d="{floor_d}" fill-rule="evenodd"/></clipPath>"#
        );
        write_grid(s, &floor, cell_px, &clip_id, theme.grid);
    }

    // Walls — stroke the floor outline
    let _ = write!(
        s,
        r#"<path d="{floor_d}" fill="none" stroke="{}" stroke-width="{:.2}" stroke-linejoin="miter" fill-rule="evenodd"/>"#,
        theme.wall,
        cell_px * 0.08
    );

    // Objects
    for obj in &layer.objects {
        write_object(s, obj, cell_px);
    }
}

fn write_object(s: &mut String, obj: &MapObject, cell_px: f64) {
    let Some(content) = symbols::symbol_svg(&obj.kind) else { return };
    let cx = (obj.at[0] as f64 + 0.5) * cell_px;
    let cy = (obj.at[1] as f64 + 0.5) * cell_px;
    let rot = obj.facing.map(|f| f.rotation_deg()).unwrap_or(0.0);
    let scale = cell_px / 100.0;
    let _ = write!(
        s,
        r#"<g transform="translate({cx:.2} {cy:.2}) rotate({rot:.1}) scale({scale:.4})">{content}</g>"#
    );
}

fn write_grid(s: &mut String, floor: &MultiPolygon<f64>, cell_px: f64, clip_id: &str, color: &str) {
    let Some(bbox) = multipolygon_bbox(floor) else { return };
    let (min_x, min_y, max_x, max_y) = bbox;
    let x_start = min_x.floor() as i32;
    let x_end = max_x.ceil() as i32;
    let y_start = min_y.floor() as i32;
    let y_end = max_y.ceil() as i32;

    let _ = write!(s, r#"<g clip-path="url(#{clip_id})" stroke="{color}" stroke-width="{:.2}" opacity="0.35">"#, cell_px * 0.02);
    for x in x_start..=x_end {
        let xp = x as f64 * cell_px;
        let _ = write!(
            s,
            r#"<line x1="{xp:.2}" y1="{:.2}" x2="{xp:.2}" y2="{:.2}"/>"#,
            min_y * cell_px,
            max_y * cell_px
        );
    }
    for y in y_start..=y_end {
        let yp = y as f64 * cell_px;
        let _ = write!(
            s,
            r#"<line x1="{:.2}" y1="{yp:.2}" x2="{:.2}" y2="{yp:.2}"/>"#,
            min_x * cell_px,
            max_x * cell_px
        );
    }
    s.push_str("</g>");
}

fn write_hatch(s: &mut String, floor: &MultiPolygon<f64>, cell_px: f64, clip_id: &str, color: &str) {
    let Some((min_x, min_y, max_x, max_y)) = multipolygon_bbox(floor) else { return };
    let _ = write!(
        s,
        r#"<g clip-path="url(#{clip_id})" stroke="{color}" stroke-width="{:.2}" opacity="0.18">"#,
        cell_px * 0.03
    );
    let step = cell_px * 0.25;
    let x0 = min_x * cell_px;
    let y0 = min_y * cell_px;
    let x1 = max_x * cell_px;
    let y1 = max_y * cell_px;
    // 45° hatching: lines of constant (x+y)
    let mut k = (x0 + y0).floor();
    let k_end = (x1 + y1).ceil();
    while k <= k_end {
        // Line from (k - y0, y0) to (k - y1, y1) — i.e. x = k - y
        let _ = write!(
            s,
            r#"<line x1="{:.2}" y1="{:.2}" x2="{:.2}" y2="{:.2}"/>"#,
            k - y0, y0, k - y1, y1
        );
        k += step;
    }
    s.push_str("</g>");
}

fn multipolygon_bbox(mp: &MultiPolygon<f64>) -> Option<(f64, f64, f64, f64)> {
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    let mut seen = false;
    for poly in &mp.0 {
        for c in poly.exterior().coords() {
            min_x = min_x.min(c.x);
            min_y = min_y.min(c.y);
            max_x = max_x.max(c.x);
            max_y = max_y.max(c.y);
            seen = true;
        }
    }
    seen.then_some((min_x, min_y, max_x, max_y))
}

fn multipolygon_to_path_d(mp: &MultiPolygon<f64>, cell_px: f64) -> String {
    let mut d = String::with_capacity(mp.0.len() * 64);
    for poly in &mp.0 {
        write_ring(&mut d, poly.exterior().coords(), cell_px);
        for hole in poly.interiors() {
            write_ring(&mut d, hole.coords(), cell_px);
        }
    }
    d
}

fn write_ring<'a, I: Iterator<Item = &'a geo::Coord<f64>>>(d: &mut String, coords: I, cell_px: f64) {
    let mut first = true;
    for c in coords {
        let x = c.x * cell_px;
        let y = c.y * cell_px;
        if first {
            let _ = write!(d, "M {x:.2} {y:.2} ");
            first = false;
        } else {
            let _ = write!(d, "L {x:.2} {y:.2} ");
        }
    }
    d.push_str("Z ");
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

struct Theme {
    background: &'static str,
    floor: &'static str,
    wall: &'static str,
    grid: &'static str,
    hatch: Option<&'static str>,
    note_color: &'static str,
}

fn theme_for(style: BackgroundStyle) -> Theme {
    match style {
        BackgroundStyle::Parchment => Theme {
            background: "#e7dcc0",
            floor: "#f6efd7",
            wall: "#1a1a1a",
            grid: "#a99775",
            hatch: Some("#a99775"),
            note_color: "#3d2c12",
        },
        BackgroundStyle::Clean => Theme {
            background: "#ffffff",
            floor: "#ffffff",
            wall: "#1a1a1a",
            grid: "#cccccc",
            hatch: None,
            note_color: "#1a1a1a",
        },
        BackgroundStyle::Blueprint => Theme {
            background: "#1d3a63",
            floor: "#22467a",
            wall: "#e8f1ff",
            grid: "#80a7d6",
            hatch: None,
            note_color: "#e8f1ff",
        },
    }
}
