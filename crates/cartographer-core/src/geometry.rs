//! Geometry: convert a layer's carves and door-objects into a unioned floor
//! [`MultiPolygon`] in **cell** coordinate space (f64).
//!
//! The model stores coordinates as [`C`] (1/12-cell units). Geometry converts
//! to f64 cells at the boundary via [`C::as_cells`] so the polygon library
//! gets clean float coords while the source model stays exact.

use crate::model::{Carve, Facing, Layer};
use crate::symbols::cuts_wall;
use crate::units::C;
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
        if cuts_wall(&obj.kind) {
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
        if cuts_wall(&obj.kind) {
            let (x, y, w, h) = door_slot_rect(obj.at, obj.facing);
            acc = union_one(acc, rect_polygon(x, y, w, h));
        }
    }
    acc
}

/// The thin slot a door object cuts into the wall, perpendicular to its
/// facing direction. Returned as `(x, y, w, h)` in cell coordinates (f64).
///
/// Made `pub(crate)` so the renderer can size door symbols to match.
pub(crate) fn door_slot_rect(at: [C; 2], facing: Option<Facing>) -> (f64, f64, f64, f64) {
    let (x, y) = (at[0].as_cells(), at[1].as_cells());
    // Slot is 50% of cell on the perpendicular axis, full cell on the parallel axis.
    let thickness = 0.50;
    let inset = (1.0 - thickness) / 2.0;
    match facing {
        // EW passage → vertical wall → horizontal slot. Diagonals collapse
        // to the nearest cardinal axis; pick whichever rotates the slot
        // closer to its intended orientation.
        Some(Facing::Ew) | Some(Facing::E) | Some(Facing::W)
        | Some(Facing::Ne) | Some(Facing::Se) | Some(Facing::Sw) | Some(Facing::Nw) => {
            (x, y + inset, 1.0, thickness)
        }
        // NS passage (or no facing) → horizontal wall → vertical slot.
        Some(Facing::Ns) | Some(Facing::N) | Some(Facing::S) | None => {
            (x + inset, y, thickness, 1.0)
        }
    }
}

/// Rectangles that make up a single carve. Rect carves are one rectangle;
/// path carves are one rectangle per segment.
fn carve_rects(carve: &Carve) -> Vec<(f64, f64, f64, f64)> {
    match carve {
        Carve::Rect(r) => vec![(
            r.x().as_cells(),
            r.y().as_cells(),
            r.w().as_cells(),
            r.h().as_cells(),
        )],
        Carve::Path(p) => p
            .path
            .windows(2)
            .map(|w| segment_bbox(w[0], w[1], p.width))
            .collect(),
    }
}

fn segment_bbox(a: [C; 2], b: [C; 2], width: C) -> (f64, f64, f64, f64) {
    let (ax, ay) = (a[0].as_cells(), a[1].as_cells());
    let (bx, by) = (b[0].as_cells(), b[1].as_cells());
    let w = width.as_cells();
    if a[1] == b[1] {
        // Horizontal segment. Endpoints are cell coords the strip *passes
        // through*, so the strip extends 1 cell past max(ax, bx).
        let x_min = ax.min(bx);
        let x_max = ax.max(bx) + 1.0;
        (x_min, ay, x_max - x_min, w)
    } else if a[0] == b[0] {
        let y_min = ay.min(by);
        let y_max = ay.max(by) + 1.0;
        (ax, y_min, w, y_max - y_min)
    } else {
        // Validator rejects diagonal segments before we reach here.
        (ax, ay, 0.0, 0.0)
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
            walls: vec![],
            doors: vec![],
            stairs: vec![],
            objects,
            notes: vec![],
            audience: Default::default(),
        }
    }

    fn rect(id: &str, [x, y, w, h]: [i32; 4]) -> Carve {
        Carve::Rect(RectCarve {
            id: id.into(),
            rect: [C::cells(x), C::cells(y), C::cells(w), C::cells(h)],
        })
    }

    fn path(id: &str, pts: Vec<[i32; 2]>, width: i32) -> Carve {
        Carve::Path(PathCarve {
            id: id.into(),
            path: pts.into_iter().map(|p| [C::cells(p[0]), C::cells(p[1])]).collect(),
            width: C::cells(width),
        })
    }

    fn door(id: &str, at: [i32; 2], facing: Facing) -> MapObject {
        MapObject {
            id: id.into(),
            kind: "door".into(),
            at: [C::cells(at[0]), C::cells(at[1])],
            facing: Some(facing),
        }
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
            vec![door("d", [5, 2], Facing::Ew)],
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
                at: [C::cells(5), C::cells(2)],
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

    #[test]
    fn half_cell_rect_round_trips() {
        // A rect carve offset by half a cell.
        let half = Carve::Rect(RectCarve {
            id: "half".into(),
            rect: [C(6), C(0), C(12), C(12)], // x=0.5, y=0, w=1, h=1
        });
        let l = layer(vec![half], vec![]);
        assert_eq!(layer_bounds(&l), Some((0.5, 0.0, 1.5, 1.0)));
    }
}
