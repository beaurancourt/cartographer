//! Map data model. Every field that serializes here is part of the public
//! file format — change with care.

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
    #[default]
    Parchment,
    Clean,
    Blueprint,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct Layer {
    pub id: String,
    #[serde(default)]
    pub style: LayerStyle,
    #[serde(default)]
    pub rooms: Vec<Room>,
    #[serde(default)]
    pub corridors: Vec<Corridor>,
    #[serde(default)]
    pub objects: Vec<MapObject>,
}

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

/// A rectangular room, expressed in cell coordinates.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct Room {
    pub id: String,
    /// `[x, y, width, height]` in cells. `x`/`y` may be negative; `w`/`h` > 0.
    pub rect: [i32; 4],
}

impl Room {
    pub fn x(&self) -> i32 { self.rect[0] }
    pub fn y(&self) -> i32 { self.rect[1] }
    pub fn w(&self) -> i32 { self.rect[2] }
    pub fn h(&self) -> i32 { self.rect[3] }
}

/// A corridor — a strip of given width along an axis-aligned polyline.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct Corridor {
    pub id: String,
    /// Sequence of `[x, y]` waypoints in cell coordinates. Segments must be
    /// horizontal or vertical (axis-aligned).
    pub path: Vec<[i32; 2]>,
    /// Width in cells. Defaults to 1.
    #[serde(default = "default_corridor_width")]
    pub width: u32,
}

fn default_corridor_width() -> u32 { 1 }

/// A placed symbol/object — door, trap, stairs, altar, etc. The `kind`
/// references a symbol registered in [`crate::symbols`].
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct MapObject {
    pub id: String,
    /// Symbol id, e.g. `door`, `secret-door`, `pit-trap`, `stairs-down`.
    #[serde(rename = "type")]
    pub kind: String,
    /// Cell coordinate where the object is centered.
    pub at: [i32; 2],
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
    /// North-South — door/passage oriented along the Y axis.
    Ns,
    /// East-West — door/passage oriented along the X axis.
    Ew,
}

impl Facing {
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
    pub at: [i32; 2],
    pub text: String,
}
