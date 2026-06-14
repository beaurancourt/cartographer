//! cartographer-core: map data model, validation, geometry, and rendering.
//!
//! A `Map` is loaded from YAML, validated, and rendered to SVG. Rasterization
//! (PNG/JPG) goes through [`render::raster`]. The same crate powers both the
//! Tauri app (via IPC) and the CLI (headless export for LLM workflows).

pub mod error;
pub mod geometry;
pub mod model;
pub mod render;
pub mod symbols;
pub mod units;
pub mod validate;

pub use error::{Error, Result};
pub use model::Map;
pub use render::{RenderOptions, ViewBundle, render_bundle, render_svg};
pub use render::raster::{ImageFormat, render_image};

/// Load and validate a map from a YAML string.
pub fn load_yaml(yaml: &str) -> Result<Map> {
    let map: Map = serde_yaml::from_str(yaml).map_err(Error::Parse)?;
    validate::validate(&map)?;
    Ok(map)
}

/// Generate the canonical JSON Schema for `Map`.
pub fn json_schema() -> serde_json::Value {
    let schema = schemars::schema_for!(Map);
    serde_json::to_value(&schema).expect("schema serializes")
}
