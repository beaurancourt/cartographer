use crate::error::{Error, Result};
use crate::model::{Carve, Map};
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

        let mut entity_ids: HashSet<String> = HashSet::new();
        for carve in &layer.carves {
            validate_carve(carve, &layer.id, &mut entity_ids)?;
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

fn validate_carve(carve: &Carve, layer_id: &str, ids: &mut HashSet<String>) -> Result<()> {
    let id = carve.id();
    if !ids.insert(id.to_string()) {
        return Err(Error::validation(format!(
            "duplicate entity id `{id}` in layer `{layer_id}`"
        )));
    }
    match carve {
        Carve::Rect(r) => {
            if r.w() <= 0 || r.h() <= 0 {
                return Err(Error::validation(format!(
                    "carve `{}` has non-positive size {}x{}",
                    r.id, r.w(), r.h()
                )));
            }
        }
        Carve::Path(p) => {
            if p.path.len() < 2 {
                return Err(Error::validation(format!(
                    "carve `{}` needs at least 2 waypoints",
                    p.id
                )));
            }
            for window in p.path.windows(2) {
                let [a, b] = [window[0], window[1]];
                if a[0] != b[0] && a[1] != b[1] {
                    return Err(Error::validation(format!(
                        "carve `{}` segment ({},{})->({},{}) is not axis-aligned",
                        p.id, a[0], a[1], b[0], b[1]
                    )));
                }
            }
            if p.width == 0 {
                return Err(Error::validation(format!(
                    "carve `{}` has zero width",
                    p.id
                )));
            }
        }
    }
    Ok(())
}
