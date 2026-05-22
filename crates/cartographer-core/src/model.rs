//! Map data model. Every field that serializes here is part of the public
//! file format — change with care.
//!
//! Coordinates are stored as [`C`] (1/12-cell units) so that halves, thirds,
//! quarters, sixths, and twelfths are exact integers. YAML/JSON authors them
//! in whole-cell units (integers when on a cell boundary, decimals otherwise).

use crate::units::C;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// A complete cartographer map.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct Map {
    /// Format version. Currently always 1.
    pub version: u32,

    #[serde(default)]
    pub grid: Grid,

    #[serde(default)]
    pub background: Background,

    pub layers: Vec<Layer>,

    #[serde(default)]
    pub notes: Vec<Note>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct Grid {
    /// Pixels per cell at 1.0 zoom. Default 50.
    pub cell_size: u32,
    /// Informational only (e.g. "ft", "m").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub units: Option<String>,
    /// Informational only — how many real-world units one cell represents.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ft_per_cell: Option<u32>,
}

impl Default for Grid {
    fn default() -> Self {
        Self { cell_size: 50, units: Some("ft".into()), ft_per_cell: Some(5) }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
pub struct Background {
    #[serde(default)]
    pub style: BackgroundStyle,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum BackgroundStyle {
    /// High-contrast black/white VTT style (Arden Vul, Old School Essentials, etc.).
    /// Black "void" with white floor; walls implicit from contrast.
    #[default]
    Ink,
    /// Warm cream parchment with hatched floor.
    Parchment,
    /// Plain white floor on white background with thin grey grid.
    Clean,
    /// Inverted "blueprint" style — white linework on dark blue.
    Blueprint,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct Layer {
    pub id: String,
    #[serde(default)]
    pub style: LayerStyle,
    /// Carve-outs that make up the floor. Each carve is either a `rect`
    /// (rectangular room) or a `path` + `width` (axis-aligned strip). The
    /// final floor is the union of every carve in the layer.
    #[serde(default)]
    pub carves: Vec<Carve>,
    #[serde(default)]
    pub objects: Vec<MapObject>,
}

/// A single carve-out. The two variants are distinguished by their fields:
/// presence of `rect` → rectangular room; presence of `path` → strip.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(untagged)]
pub enum Carve {
    /// Rectangular carve-out (room).
    Rect(RectCarve),
    /// Axis-aligned strip along a polyline.
    Path(PathCarve),
}

impl Carve {
    pub fn id(&self) -> &str {
        match self {
            Carve::Rect(r) => &r.id,
            Carve::Path(p) => &p.id,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct RectCarve {
    pub id: String,
    /// `[x, y, width, height]` in cell units. `w`/`h` must be positive.
    pub rect: [C; 4],
}

impl RectCarve {
    pub fn x(&self) -> C { self.rect[0] }
    pub fn y(&self) -> C { self.rect[1] }
    pub fn w(&self) -> C { self.rect[2] }
    pub fn h(&self) -> C { self.rect[3] }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct PathCarve {
    pub id: String,
    /// Sequence of cell-coordinate waypoints. Segments must be axis-aligned.
    pub path: Vec<[C; 2]>,
    /// Width in cell units. Defaults to 1 cell.
    #[serde(default = "default_path_width")]
    pub width: C,
}

fn default_path_width() -> C { C::cells(1) }

#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
pub struct LayerStyle {
    #[serde(default)]
    pub wall: WallStyle,
    #[serde(default)]
    pub floor: FloorStyle,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum WallStyle {
    #[default]
    Solid,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum FloorStyle {
    #[default]
    Hatched,
    Solid,
    Dotted,
}

/// A placed symbol/object — door, trap, stairs, altar, etc. The `kind`
/// references a symbol registered in [`crate::symbols`].
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct MapObject {
    pub id: String,
    /// Symbol id, e.g. `door`, `secret-door`, `pit-trap`, `stairs-down`.
    #[serde(rename = "type")]
    pub kind: String,
    /// Cell coordinate of the cell the object occupies (its symbol is drawn
    /// centered in this cell).
    pub at: [C; 2],
    /// Orientation. Doors typically use `ew`/`ns`; stairs use `n`/`s`/`e`/`w`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub facing: Option<Facing>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum Facing {
    N,
    S,
    E,
    W,
    /// North-south passage — door panel perpendicular to the N-S axis,
    /// i.e. door sits in a horizontal (east-west) wall.
    Ns,
    /// East-west passage — door panel perpendicular to the E-W axis,
    /// i.e. door sits in a vertical (north-south) wall.
    Ew,
}

impl Facing {
    /// Rotation in degrees to apply to a symbol authored in its canonical
    /// horizontal orientation (door panel wider than tall, sitting in a
    /// north-south wall — i.e. allowing east-west passage).
    ///
    /// `Ew` is the canonical orientation → no rotation. `Ns` rotates 90° so
    /// the panel becomes vertical, fitting an east-west wall.
    pub fn rotation_deg(&self) -> f32 {
        match self {
            Facing::N => 0.0,
            Facing::E => 90.0,
            Facing::S => 180.0,
            Facing::W => 270.0,
            Facing::Ew => 0.0,
            Facing::Ns => 90.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct Note {
    pub at: [C; 2],
    pub text: String,
}
