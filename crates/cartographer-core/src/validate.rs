use crate::error::{Error, Result};
use crate::model::Map;
use crate::symbols::is_known_symbol;
use std::collections::HashSet;

/// Validate a map beyond what serde checks. Returns the first error found.
pub fn validate(map: &Map) -> Result<()> {
    if map.version != 1 {
        return Err(Error::validation(format!(
            "unsupported map version {} (expected 1)",
            map.version
        )));
    }
    if map.layers.is_empty() {
        return Err(Error::validation("map must have at least one layer"));
    }

    let mut layer_ids = HashSet::new();
    for layer in &map.layers {
        if !layer_ids.insert(&layer.id) {
            return Err(Error::validation(format!("duplicate layer id `{}`", layer.id)));
        }

        let mut entity_ids = HashSet::new();
        for room in &layer.rooms {
            if !entity_ids.insert(room.id.clone()) {
                return Err(Error::validation(format!(
                    "duplicate entity id `{}` in layer `{}`",
                    room.id, layer.id
                )));
            }
            if room.w() <= 0 || room.h() <= 0 {
                return Err(Error::validation(format!(
                    "room `{}` has non-positive size {}x{}",
                    room.id, room.w(), room.h()
                )));
            }
        }

        for corr in &layer.corridors {
            if !entity_ids.insert(corr.id.clone()) {
                return Err(Error::validation(format!(
                    "duplicate entity id `{}` in layer `{}`",
                    corr.id, layer.id
                )));
            }
            if corr.path.len() < 2 {
                return Err(Error::validation(format!(
                    "corridor `{}` needs at least 2 waypoints",
                    corr.id
                )));
            }
            for window in corr.path.windows(2) {
                let [a, b] = [window[0], window[1]];
                if a[0] != b[0] && a[1] != b[1] {
                    return Err(Error::validation(format!(
                        "corridor `{}` segment ({},{})->({},{}) is not axis-aligned",
                        corr.id, a[0], a[1], b[0], b[1]
                    )));
                }
            }
            if corr.width == 0 {
                return Err(Error::validation(format!(
                    "corridor `{}` has zero width",
                    corr.id
                )));
            }
        }

        for obj in &layer.objects {
            if !entity_ids.insert(obj.id.clone()) {
                return Err(Error::validation(format!(
                    "duplicate entity id `{}` in layer `{}`",
                    obj.id, layer.id
                )));
            }
            if !is_known_symbol(&obj.kind) {
                return Err(Error::UnknownSymbol(obj.kind.clone()));
            }
        }
    }

    Ok(())
}
