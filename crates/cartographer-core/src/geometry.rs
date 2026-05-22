//! Geometry: convert a layer's carves and door-objects into a unioned floor
//! [`MultiPolygon`] in cell-coordinate space.
//!
//! **Carve convention.** Every carve is either a rectangle or an axis-aligned
//! strip along a polyline. Rect `[x, y, w, h]` occupies float-space
//! `[x, x+w] × [y, y+h]`. Strip `path: [[5,2],[10,2]], width: 1` treats each
//! waypoint as a cell coordinate the strip *passes through*, so it covers
//! cells 5..=10 horizontally — i.e. `x ∈ [5, 11]`. Width is the perpendicular
//! thickness (extending right for vertical, down for horizontal).
//!
//! **Doors.** Door-like objects (`door`, `secret-door`, `locked-door`) punch
//! a thin slot in the wall, perpendicular to the door's facing. The slot
//! connects the rooms on either side and the door symbol is drawn across it.

use crate::model::{Carve, Facing, Layer};
use crate::symbols::is_door_like;
use geo::{BooleanOps, LineString, MultiPolygon, Polygon};

/// Bounding box of all carves in a layer, in cell coordinates.
pub fn layer_bounds(layer: &Layer) -> Option<(f64, f64, f64, f64)> {
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    let mut seen = false;

    let mut grow = |x: f64, y: f64, w: f64, h: f64| {
        min_x = min_x.min(x);
        min_y = min_y.min(y);
        max_x = max_x.max(x + w);
        max_y = max_y.max(y + h);
        seen = true;
    };

    for carve in &layer.carves {
        for (x, y, w, h) in carve_rects(carve) {
            grow(x, y, w, h);
        }
    }
    for obj in &layer.objects {
        if is_door_like(&obj.kind) {
            let (x, y, w, h) = door_slot_rect(obj.at, obj.facing);
            grow(x, y, w, h);
        }
    }

    seen.then_some((min_x, min_y, max_x, max_y))
}

/// Union of all carves and door slots in the layer.
pub fn layer_floor(layer: &Layer) -> MultiPolygon<f64> {
    let mut acc: MultiPolygon<f64> = MultiPolygon::new(vec![]);

    for carve in &layer.carves {
        for (x, y, w, h) in carve_rects(carve) {
            acc = union_one(acc, rect_polygon(x, y, w, h));
        }
    }
    for obj in &layer.objects {
        if is_door_like(&obj.kind) {
            let (x, y, w, h) = door_slot_rect(obj.at, obj.facing);
            acc = union_one(acc, rect_polygon(x, y, w, h));
        }
    }
    acc
}

/// The thin slot a door object cuts into the wall, perpendicular to its
/// facing direction. Returned as `(x, y, w, h)` in cell coordinates.
///
/// Made `pub(crate)` so the renderer can size door symbols to match.
pub(crate) fn door_slot_rect(at: [i32; 2], facing: Option<Facing>) -> (f64, f64, f64, f64) {
    let (x, y) = (at[0] as f64, at[1] as f64);
    // Slot is 40% of cell on the perpendicular axis, full cell on the parallel axis.
    let thickness = 0.40;
    let inset = (1.0 - thickness) / 2.0;
    match facing {
        // EW passage → vertical wall → slot stretches horizontally across the gap.
        Some(Facing::Ew) | Some(Facing::E) | Some(Facing::W) => {
            (x, y + inset, 1.0, thickness)
        }
        // NS passage (or facing not specified) → horizontal wall → slot stretches vertically.
        Some(Facing::Ns) | Some(Facing::N) | Some(Facing::S) | None => {
            (x + inset, y, thickness, 1.0)
        }
    }
}

/// Yield the rectangles that make up a single carve. Rect carves are one
/// rectangle; path carves are one rectangle per segment.
fn carve_rects(carve: &Carve) -> Vec<(f64, f64, f64, f64)> {
    match carve {
        Carve::Rect(r) => vec![(r.x() as f64, r.y() as f64, r.w() as f64, r.h() as f64)],
        Carve::Path(p) => p
            .path
            .windows(2)
            .map(|w| segment_bbox(w[0], w[1], p.width))
            .collect(),
    }
}

fn segment_bbox(a: [i32; 2], b: [i32; 2], width: u32) -> (f64, f64, f64, f64) {
    let w = width as f64;
    if a[1] == b[1] {
        let x_min = a[0].min(b[0]) as f64;
        let x_max = a[0].max(b[0]) as f64 + 1.0;
        let y = a[1] as f64;
        (x_min, y, x_max - x_min, w)
    } else if a[0] == b[0] {
        let x = a[0] as f64;
        let y_min = a[1].min(b[1]) as f64;
        let y_max = a[1].max(b[1]) as f64 + 1.0;
        (x, y_min, w, y_max - y_min)
    } else {
        // Validator rejects diagonal segments before we reach here.
        (a[0] as f64, a[1] as f64, 0.0, 0.0)
    }
}

fn union_one(acc: MultiPolygon<f64>, p: Polygon<f64>) -> MultiPolygon<f64> {
    if acc.0.is_empty() {
        return MultiPolygon::new(vec![p]);
    }
    acc.union(&MultiPolygon::new(vec![p]))
}

fn rect_polygon(x: f64, y: f64, w: f64, h: f64) -> Polygon<f64> {
    Polygon::new(
        LineString::from(vec![
            (x, y),
            (x + w, y),
            (x + w, y + h),
            (x, y + h),
            (x, y),
        ]),
        vec![],
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Carve, Facing, Layer, MapObject, PathCarve, RectCarve};

    fn layer(carves: Vec<Carve>, objects: Vec<MapObject>) -> Layer {
        Layer {
            id: "main".into(),
            style: Default::default(),
            carves,
            objects,
        }
    }

    fn rect(id: &str, r: [i32; 4]) -> Carve {
        Carve::Rect(RectCarve { id: id.into(), rect: r })
    }

    fn path(id: &str, path: Vec<[i32; 2]>, width: u32) -> Carve {
        Carve::Path(PathCarve { id: id.into(), path, width })
    }

    #[test]
    fn single_rect_bounds() {
        let l = layer(vec![rect("r", [2, 3, 4, 5])], vec![]);
        assert_eq!(layer_bounds(&l), Some((2.0, 3.0, 6.0, 8.0)));
    }

    #[test]
    fn two_disjoint_rects_produce_two_polygons() {
        let l = layer(
            vec![rect("a", [0, 0, 2, 2]), rect("b", [10, 0, 2, 2])],
            vec![],
        );
        assert_eq!(layer_floor(&l).0.len(), 2);
    }

    #[test]
    fn touching_rects_union_into_one() {
        let l = layer(
            vec![rect("a", [0, 0, 5, 5]), rect("b", [5, 0, 5, 5])],
            vec![],
        );
        assert_eq!(layer_floor(&l).0.len(), 1);
    }

    #[test]
    fn door_slot_bridges_two_rooms() {
        let l = layer(
            vec![rect("a", [0, 0, 5, 5]), rect("b", [6, 0, 5, 5])],
            vec![MapObject {
                id: "d".into(),
                kind: "door".into(),
                at: [5, 2],
                facing: Some(Facing::Ew),
            }],
        );
        assert_eq!(layer_floor(&l).0.len(), 1, "door slot should bridge the rooms");
    }

    #[test]
    fn non_door_object_does_not_bridge() {
        let l = layer(
            vec![rect("a", [0, 0, 5, 5]), rect("b", [6, 0, 5, 5])],
            vec![MapObject {
                id: "c".into(),
                kind: "column".into(),
                at: [5, 2],
                facing: None,
            }],
        );
        assert_eq!(layer_floor(&l).0.len(), 2);
    }

    #[test]
    fn path_carve_connects_two_rooms() {
        let l = layer(
            vec![
                rect("a", [0, 0, 5, 5]),
                rect("b", [10, 0, 5, 5]),
                path("c", vec![[5, 2], [9, 2]], 1),
            ],
            vec![],
        );
        assert_eq!(layer_floor(&l).0.len(), 1);
    }
}
