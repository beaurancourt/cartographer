use crate::error::{Error, Result};
use crate::model::{Carve, Map};
use crate::symbols::is_known_symbol;
use crate::units::C;
use std::collections::HashSet;

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
            if r.w() <= C::ZERO || r.h() <= C::ZERO {
                return Err(Error::validation(format!(
                    "carve `{}` has non-positive size {}x{}",
                    r.id,
                    r.w().as_cells(),
                    r.h().as_cells()
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
                        p.id,
                        a[0].as_cells(),
                        a[1].as_cells(),
                        b[0].as_cells(),
                        b[1].as_cells()
                    )));
                }
            }
            if p.width <= C::ZERO {
                return Err(Error::validation(format!(
                    "carve `{}` has non-positive width",
                    p.id
                )));
            }
        }
    }
    Ok(())
}
