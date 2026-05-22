//! Built-in symbol registry. Symbols are SVG inner-content fragments
//! authored in a 100×100 unit box centered at the origin (-50..50). The
//! renderer wraps each placement in a `<g>` with translate/rotate/scale.
//!
//! To add a symbol: drop `assets/symbols/<id>.svg` and register it here.
//! See `assets/symbols/README.md`.

macro_rules! sym {
    ($id:literal) => {
        ($id, include_str!(concat!("../../../assets/symbols/", $id, ".svg")))
    };
}

pub const SYMBOLS: &[(&str, &str)] = &[
    sym!("door"),
    sym!("secret-door"),
    sym!("locked-door"),
    sym!("pit"),
    sym!("pit-trap"),
    sym!("stairs-up"),
    sym!("stairs-down"),
    sym!("column"),
    sym!("altar"),
    sym!("fountain"),
    sym!("statue"),
    sym!("fireplace"),
    sym!("throne"),
    sym!("rubble"),
    sym!("water"),
];

pub fn is_known_symbol(id: &str) -> bool {
    SYMBOLS.iter().any(|(k, _)| *k == id)
}

pub fn symbol_svg(id: &str) -> Option<&'static str> {
    SYMBOLS.iter().find(|(k, _)| *k == id).map(|(_, v)| *v)
}

pub fn known_ids() -> impl Iterator<Item = &'static str> {
    SYMBOLS.iter().map(|(k, _)| *k)
}

/// Door-like symbols add their cell to the floor union, "cutting" a 1-cell
/// opening in any wall the cell falls on. Used by [`crate::geometry`].
pub fn is_door_like(id: &str) -> bool {
    matches!(id, "door" | "secret-door" | "locked-door")
}
