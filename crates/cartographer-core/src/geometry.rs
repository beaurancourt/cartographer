//! Geometry: convert a layer's rooms + corridors into a unioned floor
//! [`MultiPolygon`] in cell-coordinate space.
//!
//! Convention: a room with `rect: [x, y, w, h]` occupies the square
//! `[x, x+w] × [y, y+h]` in float space. A corridor with axis-aligned
//! path waypoints treats each waypoint as a cell coordinate the corridor
//! *passes through*, so e.g. `path: [[5,2],[10,2]]` covers cells 5..=10
//! horizontally — i.e. `x ∈ [5, 11]`. Width is the perpendicular thickness
//! (extending right for vertical, down for horizontal).

use crate::model::Layer;
use geo::{BooleanOps, LineString, MultiPolygon, Polygon};

/// Bounding box of all rooms+corridors in a layer, in cell coordinates.
pub fn layer_bounds(layer: &Layer) -> Option<(f64, f64, f64, f64)> {
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    let mut seen = false;

    for room in &layer.rooms {
        let (x, y, w, h) = (
            room.x() as f64,
            room.y() as f64,
            room.w() as f64,
            room.h() as f64,
        );
        min_x = min_x.min(x);
        min_y = min_y.min(y);
        max_x = max_x.max(x + w);
        max_y = max_y.max(y + h);
        seen = true;
    }
    for corridor in &layer.corridors {
        for window in corridor.path.windows(2) {
            let (x, y, w, h) = corridor_segment_bbox(window[0], window[1], corridor.width);
            min_x = min_x.min(x);
            min_y = min_y.min(y);
            max_x = max_x.max(x + w);
            max_y = max_y.max(y + h);
            seen = true;
        }
    }

    seen.then_some((min_x, min_y, max_x, max_y))
}

/// Union of all rooms and corridors in the layer, producing the floor
/// region. The boundary of this polygon set is the wall geometry.
pub fn layer_floor(layer: &Layer) -> MultiPolygon<f64> {
    let mut acc: MultiPolygon<f64> = MultiPolygon::new(vec![]);

    for room in &layer.rooms {
        acc = union_one(acc, rect_polygon(room.x() as f64, room.y() as f64, room.w() as f64, room.h() as f64));
    }
    for corridor in &layer.corridors {
        for window in corridor.path.windows(2) {
            let (x, y, w, h) = corridor_segment_bbox(window[0], window[1], corridor.width);
            acc = union_one(acc, rect_polygon(x, y, w, h));
        }
    }
    acc
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

fn corridor_segment_bbox(a: [i32; 2], b: [i32; 2], width: u32) -> (f64, f64, f64, f64) {
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
        // Validator catches this case before we get here.
        (a[0] as f64, a[1] as f64, 0.0, 0.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Corridor, Layer, Room};

    fn layer(rooms: Vec<Room>, corridors: Vec<Corridor>) -> Layer {
        Layer {
            id: "main".into(),
            style: Default::default(),
            rooms,
            corridors,
            objects: vec![],
        }
    }

    #[test]
    fn single_room_bounds() {
        let l = layer(vec![Room { id: "r".into(), rect: [2, 3, 4, 5] }], vec![]);
        assert_eq!(layer_bounds(&l), Some((2.0, 3.0, 6.0, 8.0)));
    }

    #[test]
    fn two_disjoint_rooms_produce_two_polygons() {
        let l = layer(
            vec![
                Room { id: "a".into(), rect: [0, 0, 2, 2] },
                Room { id: "b".into(), rect: [10, 0, 2, 2] },
            ],
            vec![],
        );
        let mp = layer_floor(&l);
        assert_eq!(mp.0.len(), 2);
    }

    #[test]
    fn touching_rooms_union_into_one() {
        let l = layer(
            vec![
                Room { id: "a".into(), rect: [0, 0, 5, 5] },
                Room { id: "b".into(), rect: [5, 0, 5, 5] }, // shares the x=5 edge
            ],
            vec![],
        );
        let mp = layer_floor(&l);
        assert_eq!(mp.0.len(), 1, "touching rooms should union into one");
    }

    #[test]
    fn corridor_connects_two_rooms() {
        let l = layer(
            vec![
                Room { id: "a".into(), rect: [0, 0, 5, 5] },
                Room { id: "b".into(), rect: [10, 0, 5, 5] },
            ],
            vec![Corridor {
                id: "c".into(),
                path: vec![[5, 2], [9, 2]],
                width: 1,
            }],
        );
        let mp = layer_floor(&l);
        assert_eq!(mp.0.len(), 1, "corridor should bridge the rooms");
    }
}
