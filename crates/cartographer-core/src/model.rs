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

    pub layers: Vec<Layer>,
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct Layer {
    pub id: String,
    /// Carve-outs that make up the floor. Each carve is either a `rect`
    /// (rectangular room) or a `path` + `width` (axis-aligned strip). The
    /// final floor is the union of every carve in the layer.
    #[serde(default)]
    pub carves: Vec<Carve>,
    /// Internal walls drawn as lines over the floor.
    #[serde(default)]
    pub walls: Vec<Wall>,
    /// Doors defined by two anchor points. The panel runs along the
    /// segment; tick marks cap the endpoints.
    #[serde(default)]
    pub doors: Vec<Door>,
    /// Stairs defined by three anchors — anchors 0 and 1 are the two
    /// corners of the "up" end, anchor 2 is the bottom.
    #[serde(default)]
    pub stairs: Vec<Stairs>,
    #[serde(default)]
    pub objects: Vec<MapObject>,
    /// Free-floating text annotations anchored to a cell. Drawn over the
    /// floor and walls; respects the layer's audience (gm-only by default
    /// when authored via the editor).
    #[serde(default)]
    pub notes: Vec<Note>,
    /// Who sees this layer.
    ///   `shared` (default) — visible in both GM and Player views.
    ///   `player` — visible to players (and to the GM in the editor).
    ///   `gm`     — visible only in GM view (secret-door markers, trap
    ///              notes, monster placements).
    #[serde(default)]
    pub audience: Audience,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Audience {
    #[default]
    Shared,
    Player,
    Gm,
}

/// Two render modes. `Gm` shows every layer; `Player` skips `Audience::Gm`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum View {
    Gm,
    Player,
}

impl Audience {
    pub fn visible_in(self, view: View) -> bool {
        match (view, self) {
            (_, Audience::Shared) => true,
            (View::Gm, _) => true,
            (View::Player, Audience::Player) => true,
            (View::Player, Audience::Gm) => false,
        }
    }
}

/// An axis-aligned wall segment, drawn as a thick black line on top of the
/// floor. Use to mark a wall where two carves touch (or anywhere inside a
/// single carve to subdivide it visually).
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct Wall {
    pub id: String,
    /// Endpoints of the wall segment, axis-aligned.
    pub segment: [[C; 2]; 2],
}

/// A door defined by two anchor points. The panel runs along the segment;
/// thickness extends perpendicularly. Door geometry isn't axis-aligned —
/// anchors can be at any sub-cell position.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct Door {
    pub id: String,
    pub segment: [[C; 2]; 2],
    #[serde(default)]
    pub kind: DoorKind,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DoorKind {
    #[default]
    Door,
    SecretDoor,
    LockedDoor,
    /// A window: a glazed opening in the wall. Drawn as a small box
    /// straddling the wall line with a perpendicular mullion. Visible in
    /// both views (architecture, not a secret).
    Window,
    /// An arrow slit / arrow loop: a narrow defensive opening. Drawn as two
    /// heavy bars tapering to a slit at the centre. Visible in both views.
    ArrowSlit,
}

/// Stairs defined by three anchors. Anchors `[0]` and `[1]` are the two
/// corners of the "up" end (small steps); anchor `[2]` is the "bottom"
/// (big steps). The stairs span the rectangle whose top edge is `[0]→[1]`
/// and which extends perpendicularly toward `[2]`.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct Stairs {
    pub id: String,
    pub anchors: [[C; 2]; 3],
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

/// A placed symbol/object — door, trap, stairs, altar, etc. The `kind`
/// references a symbol registered in [`crate::symbols`].
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct MapObject {
    pub id: String,
    /// Symbol id, e.g. `door`, `secret-door`, `trap`, `stairs-down`.
    #[serde(rename = "type")]
    pub kind: String,
    /// Cell coordinate of the cell the object occupies (its symbol is drawn
    /// centered in this cell).
    pub at: [C; 2],
    /// Orientation. Objects use one of the 8 compass directions
    /// (`n`/`ne`/`e`/`se`/`s`/`sw`/`w`/`nw`); the `ew`/`ns` variants exist
    /// only as legacy aliases for the deprecated object-style doors.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub facing: Option<Facing>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum Facing {
    N,
    Ne,
    E,
    Se,
    S,
    Sw,
    W,
    Nw,
    /// North-south passage — door panel perpendicular to the N-S axis,
    /// i.e. door sits in a horizontal (east-west) wall. Legacy alias kept
    /// for object-style doors; new code prefers the 8 cardinal directions.
    Ns,
    /// East-west passage — door panel perpendicular to the E-W axis,
    /// i.e. door sits in a vertical (north-south) wall. Legacy alias.
    Ew,
}

impl Facing {
    /// Rotation in degrees clockwise to apply to a symbol authored in its
    /// canonical north-up orientation. North = 0°, east = 90°, and so on
    /// around the compass.
    pub fn rotation_deg(&self) -> f32 {
        match self {
            Facing::N => 0.0,
            Facing::Ne => 45.0,
            Facing::E => 90.0,
            Facing::Se => 135.0,
            Facing::S => 180.0,
            Facing::Sw => 225.0,
            Facing::W => 270.0,
            Facing::Nw => 315.0,
            Facing::Ew => 0.0,
            Facing::Ns => 90.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct Note {
    pub id: String,
    pub at: [C; 2],
    pub text: String,
}
