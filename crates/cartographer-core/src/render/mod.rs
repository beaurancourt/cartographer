//! SVG rendering from a [`Map`].

pub mod raster;

use crate::geometry;
use crate::model::{
    BackgroundStyle, Door, DoorKind, FloorStyle, Layer, Map, MapObject, Stairs, View,
};
use crate::symbols;
use geo::MultiPolygon;
use std::fmt::Write as _;

#[derive(Debug, Clone)]
pub struct RenderOptions {
    /// Padding (in cells) around the bounding box. Ignored if `viewbox` is set.
    pub padding_cells: f64,
    /// Whether to draw the grid overlay on the floor.
    pub show_grid: bool,
    /// Override the viewBox. `[x, y, w, h]` in pixel units (cell_size already
    /// applied). Useful for the editor which keeps a fixed canvas regardless
    /// of map size.
    pub viewbox: Option<[f64; 4]>,
    /// If true, skip the background fill rect — the host (editor) supplies
    /// its own backdrop and grid.
    pub transparent_background: bool,
    /// Which render mode to use. `Gm` shows every layer; `Player` filters
    /// out gm-audience layers and swaps locked-doors for plain doors.
    pub view: View,
}

impl Default for RenderOptions {
    fn default() -> Self {
        Self {
            padding_cells: 2.0,
            show_grid: true,
            viewbox: None,
            transparent_background: false,
            view: View::Gm,
        }
    }
}

/// Render a [`Map`] to a complete SVG document string.
pub fn render_svg(map: &Map, opts: &RenderOptions) -> String {
    let cell_px = map.grid.cell_size as f64;

    let (vb_x, vb_y, vb_w, vb_h) = match opts.viewbox {
        Some([x, y, w, h]) => (x, y, w, h),
        None => {
            let (min_cx, min_cy, max_cx, max_cy) =
                layers_bounds(map).unwrap_or((0.0, 0.0, 10.0, 10.0));
            let pad = opts.padding_cells;
            (
                (min_cx - pad) * cell_px,
                (min_cy - pad) * cell_px,
                (max_cx - min_cx + pad * 2.0) * cell_px,
                (max_cy - min_cy + pad * 2.0) * cell_px,
            )
        }
    };

    let theme = theme_for(map.background.style);
    let mut s = String::with_capacity(8192);

    let _ = write!(
        s,
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="{vb_w:.0}" height="{vb_h:.0}" viewBox="{vb_x:.2} {vb_y:.2} {vb_w:.2} {vb_h:.2}">"#
    );

    if !opts.transparent_background {
        let _ = write!(
            s,
            r#"<rect x="{vb_x:.2}" y="{vb_y:.2}" width="{vb_w:.2}" height="{vb_h:.2}" fill="{}"/>"#,
            theme.background
        );
    }

    for layer in &map.layers {
        if !layer.audience.visible_in(opts.view) {
            continue;
        }
        render_layer(&mut s, layer, cell_px, &theme, opts);
    }

    for note in &map.notes {
        let cx = (note.at[0].as_cells() + 0.5) * cell_px;
        let cy = (note.at[1].as_cells() + 0.5) * cell_px;
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
        // Always include all layers in the bbox so the viewport doesn't snap
        // around when the user toggles GM/Player view.
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
    let has_floor = !floor.0.is_empty();
    let floor_d = if has_floor {
        multipolygon_to_path_d(&floor, cell_px)
    } else {
        String::new()
    };

    if has_floor {
        // Floor fill — the contrast against the background IS the wall.
        let _ = write!(
            s,
            r#"<path d="{floor_d}" fill="{}" fill-rule="evenodd"/>"#,
            theme.floor
        );

        if matches!(layer.style.floor, FloorStyle::Hatched) && theme.hatch.is_some() {
            let clip_id = format!("clip-{}", layer.id);
            let _ = write!(
                s,
                r#"<clipPath id="{clip_id}"><path d="{floor_d}" fill-rule="evenodd"/></clipPath>"#
            );
            write_hatch(s, &floor, cell_px, &clip_id, theme.hatch.unwrap());
        }

        if opts.show_grid {
            let clip_id = format!("grid-clip-{}", layer.id);
            let _ = write!(
                s,
                r#"<clipPath id="{clip_id}"><path d="{floor_d}" fill-rule="evenodd"/></clipPath>"#
            );
            write_grid(s, &floor, cell_px, &clip_id, theme.grid, theme.grid_opacity);
        }

        if let Some(stroke_color) = theme.wall_stroke {
            let _ = write!(
                s,
                r#"<path d="{floor_d}" fill="none" stroke="{stroke_color}" stroke-width="{:.2}" stroke-linejoin="miter" fill-rule="evenodd"/>"#,
                cell_px * theme.wall_stroke_width
            );
        }
    }

    // Explicit walls — thick black lines drawn over the floor (clipped to it),
    // so e.g. two touching rooms can have a visible wall between them and a
    // secret door can sit on it. Walls without a floor in this layer aren't
    // clipped — they draw freely.
    if !layer.walls.is_empty() {
        if has_floor {
            let clip_id = format!("wall-clip-{}", layer.id);
            let _ = write!(
                s,
                r#"<clipPath id="{clip_id}"><path d="{floor_d}" fill-rule="evenodd"/></clipPath>"#
            );
            let _ = write!(
                s,
                r#"<g clip-path="url(#{clip_id})" stroke="{}" stroke-width="{:.2}" stroke-linecap="square">"#,
                theme.interior_wall, cell_px * 0.10
            );
        } else {
            let _ = write!(
                s,
                r#"<g stroke="{}" stroke-width="{:.2}" stroke-linecap="square">"#,
                theme.interior_wall, cell_px * 0.10
            );
        }
        for wall in &layer.walls {
            let [a, b] = wall.segment;
            let _ = write!(
                s,
                r#"<line x1="{:.2}" y1="{:.2}" x2="{:.2}" y2="{:.2}"/>"#,
                a[0].as_cells() * cell_px,
                a[1].as_cells() * cell_px,
                b[0].as_cells() * cell_px,
                b[1].as_cells() * cell_px
            );
        }
        s.push_str("</g>");
    }

    for stairs in &layer.stairs {
        write_stairs(s, stairs, cell_px);
    }
    for door in &layer.doors {
        write_door(s, door, cell_px, opts.view);
    }
    for obj in &layer.objects {
        write_object(s, obj, cell_px, opts.view);
    }
}

fn write_door(s: &mut String, door: &Door, cell_px: f64, view: View) {
    let black = "#000000";
    let white = "#ffffff";
    let (ax, ay) = (door.segment[0][0].as_cells() * cell_px, door.segment[0][1].as_cells() * cell_px);
    let (bx, by) = (door.segment[1][0].as_cells() * cell_px, door.segment[1][1].as_cells() * cell_px);
    let dx = bx - ax;
    let dy = by - ay;
    let len = (dx * dx + dy * dy).sqrt();
    if len < 0.5 {
        return;
    }
    let ux = dx / len;
    let uy = dy / len;
    let nx = -uy;
    let ny = ux;
    let mx = (ax + bx) / 2.0;
    let my = (ay + by) / 2.0;

    // In player view, locked- and secret-doors render as plain doors —
    // the lock dot and the S marker are both GM-only information.
    let show_kind = if view == View::Player {
        DoorKind::Door
    } else {
        door.kind
    };

    // Base render: thin white panel with black outline + a black stub
    // line at each end of the segment (anchor → panel-end, centered
    // perpendicular). Same shape for every door kind.
    let panel_thick = cell_px * 0.11;
    let panel_inset = (len * 0.10).min(cell_px * 0.18);
    let stroke_w = cell_px * 0.05;

    let pa = (ax + ux * panel_inset, ay + uy * panel_inset);
    let pb = (bx - ux * panel_inset, by - uy * panel_inset);

    let _ = write!(
        s,
        r#"<line x1="{ax:.2}" y1="{ay:.2}" x2="{:.2}" y2="{:.2}" stroke="{black}" stroke-width="{stroke_w:.2}" stroke-linecap="square"/>"#,
        pa.0, pa.1
    );
    let _ = write!(
        s,
        r#"<line x1="{bx:.2}" y1="{by:.2}" x2="{:.2}" y2="{:.2}" stroke="{black}" stroke-width="{stroke_w:.2}" stroke-linecap="square"/>"#,
        pb.0, pb.1
    );

    let pc1 = (pa.0 + nx * panel_thick, pa.1 + ny * panel_thick);
    let pc2 = (pb.0 + nx * panel_thick, pb.1 + ny * panel_thick);
    let pc3 = (pb.0 - nx * panel_thick, pb.1 - ny * panel_thick);
    let pc4 = (pa.0 - nx * panel_thick, pa.1 - ny * panel_thick);
    let _ = write!(
        s,
        r#"<polygon points="{:.2},{:.2} {:.2},{:.2} {:.2},{:.2} {:.2},{:.2}" fill="{white}" stroke="{black}" stroke-width="{stroke_w:.2}"/>"#,
        pc1.0, pc1.1, pc2.0, pc2.1, pc3.0, pc3.1, pc4.0, pc4.1
    );

    // Kind-specific overlay (only in GM view).
    match show_kind {
        DoorKind::Door => {}
        DoorKind::LockedDoor => {
            let _ = write!(
                s,
                r#"<circle cx="{mx:.2}" cy="{my:.2}" r="{:.2}" fill="{black}"/>"#,
                cell_px * 0.07
            );
        }
        DoorKind::SecretDoor => {
            // S inscribed in the panel. Rotate so the letter stays upright
            // for vertical doors too (otherwise the panel rotation would
            // put it on its side).
            let angle_deg = uy.atan2(ux).to_degrees();
            // Rotate text so it reads along the segment direction; for
            // segments pointing up/down we want the letter still upright,
            // so flip 180° when the segment points "up" (uy < 0) or "left"
            // (uy == 0 && ux < 0).
            let final_angle = if angle_deg.abs() > 90.0 {
                angle_deg + 180.0
            } else {
                angle_deg
            };
            let _ = write!(
                s,
                r#"<text x="{mx:.2}" y="{:.2}" text-anchor="middle" font-family="Georgia, serif" font-size="{:.2}" font-style="italic" font-weight="bold" fill="{black}" transform="rotate({final_angle:.1} {mx:.2} {my:.2})">S</text>"#,
                my + cell_px * 0.07,
                cell_px * 0.20
            );
        }
    }
}

fn write_stairs(s: &mut String, stairs: &Stairs, cell_px: f64) {
    let black = "#000000";
    let p = stairs
        .anchors
        .iter()
        .map(|a| (a[0].as_cells() * cell_px, a[1].as_cells() * cell_px))
        .collect::<Vec<_>>();
    let (ax, ay) = p[0];
    let (bx, by) = p[1];
    let (px3, py3) = p[2];
    let dx = bx - ax;
    let dy = by - ay;
    let top_len = (dx * dx + dy * dy).sqrt();
    if top_len < 1.0 {
        return;
    }
    let ux = dx / top_len;
    let uy = dy / top_len;
    let mut nx = -uy;
    let mut ny = ux;
    let rel_dot = (px3 - ax) * nx + (py3 - ay) * ny;
    if rel_dot < 0.0 {
        nx = -nx;
        ny = -ny;
    }
    let length = rel_dot.abs();
    let mid_x = (ax + bx) / 2.0;
    let mid_y = (ay + by) / 2.0;

    let r1 = (ax, ay);
    let r2 = (bx, by);
    let r3 = (bx + nx * length, by + ny * length);
    let r4 = (ax + nx * length, ay + ny * length);
    let _ = write!(
        s,
        r#"<polygon points="{:.2},{:.2} {:.2},{:.2} {:.2},{:.2} {:.2},{:.2}" fill="none" stroke="{black}" stroke-width="{:.2}"/>"#,
        r1.0, r1.1, r2.0, r2.1, r3.0, r3.1, r4.0, r4.1, cell_px * 0.04
    );

    let num_steps = ((length / (cell_px * 0.18)).round() as i32).max(4).min(28);
    for i in 1..=num_steps {
        let t = i as f64 / (num_steps + 1) as f64;
        // Top (anchors 0–1) is the "up" end of the stairs and is closer to
        // the viewer in a top-down view — so steps are widest at the top
        // and narrow toward the bottom (anchor 2).
        let step_len = top_len * (0.08 + 0.92 * (1.0 - t));
        let half = step_len / 2.0;
        let cxp = mid_x + nx * length * t;
        let cyp = mid_y + ny * length * t;
        let sx = cxp - ux * half;
        let sy = cyp - uy * half;
        let ex = cxp + ux * half;
        let ey = cyp + uy * half;
        let _ = write!(
            s,
            r#"<line x1="{sx:.2}" y1="{sy:.2}" x2="{ex:.2}" y2="{ey:.2}" stroke="{black}" stroke-width="{:.2}"/>"#,
            cell_px * 0.05
        );
    }
}

fn write_object(s: &mut String, obj: &MapObject, cell_px: f64, view: View) {
    // Player view sees a locked door as a normal door — the lock is GM info.
    let kind: &str = if view == View::Player && obj.kind == "locked-door" {
        "door"
    } else {
        obj.kind.as_str()
    };
    let Some(content) = symbols::symbol_svg(kind) else { return };
    let cx = (obj.at[0].as_cells() + 0.5) * cell_px;
    let cy = (obj.at[1].as_cells() + 0.5) * cell_px;
    let rot = obj.facing.map(|f| f.rotation_deg()).unwrap_or(0.0);
    let scale = cell_px / 100.0;
    let _ = write!(
        s,
        r#"<g transform="translate({cx:.2} {cy:.2}) rotate({rot:.1}) scale({scale:.4})">{content}</g>"#
    );
}

fn write_grid(s: &mut String, floor: &MultiPolygon<f64>, cell_px: f64, clip_id: &str, color: &str, opacity: f32) {
    let Some(bbox) = multipolygon_bbox(floor) else { return };
    let (min_x, min_y, max_x, max_y) = bbox;
    let x_start = min_x.floor() as i32;
    let x_end = max_x.ceil() as i32;
    let y_start = min_y.floor() as i32;
    let y_end = max_y.ceil() as i32;

    let _ = write!(
        s,
        r#"<g clip-path="url(#{clip_id})" stroke="{color}" stroke-width="{:.2}" opacity="{opacity:.2}">"#,
        cell_px * 0.02
    );
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
    let mut k = (x0 + y0).floor();
    let k_end = (x1 + y1).ceil();
    while k <= k_end {
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
    /// If `Some`, the floor outline is stroked in this color. If `None`, walls
    /// are implicit — the contrast between `background` and `floor` reads as
    /// the wall (Arden Vul / OSR VTT-black style).
    wall_stroke: Option<&'static str>,
    wall_stroke_width: f64,
    /// Color for explicit `Wall` segments drawn over the floor.
    interior_wall: &'static str,
    grid: &'static str,
    grid_opacity: f32,
    hatch: Option<&'static str>,
    note_color: &'static str,
}

fn theme_for(style: BackgroundStyle) -> Theme {
    match style {
        BackgroundStyle::Ink => Theme {
            background: "#000000",
            floor: "#ffffff",
            wall_stroke: None,
            wall_stroke_width: 0.0,
            interior_wall: "#000000",
            grid: "#000000",
            grid_opacity: 0.55,
            hatch: None,
            note_color: "#000000",
        },
        BackgroundStyle::Parchment => Theme {
            background: "#e7dcc0",
            floor: "#f6efd7",
            wall_stroke: Some("#1a1a1a"),
            wall_stroke_width: 0.08,
            interior_wall: "#1a1a1a",
            grid: "#a99775",
            grid_opacity: 0.35,
            hatch: Some("#a99775"),
            note_color: "#3d2c12",
        },
        BackgroundStyle::Clean => Theme {
            background: "#ffffff",
            floor: "#ffffff",
            wall_stroke: Some("#1a1a1a"),
            wall_stroke_width: 0.06,
            interior_wall: "#1a1a1a",
            grid: "#cccccc",
            grid_opacity: 0.7,
            hatch: None,
            note_color: "#1a1a1a",
        },
        BackgroundStyle::Blueprint => Theme {
            background: "#1d3a63",
            floor: "#22467a",
            wall_stroke: Some("#e8f1ff"),
            wall_stroke_width: 0.06,
            interior_wall: "#e8f1ff",
            grid: "#80a7d6",
            grid_opacity: 0.5,
            hatch: None,
            note_color: "#e8f1ff",
        },
    }
}
