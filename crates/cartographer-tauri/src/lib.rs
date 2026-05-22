use cartographer_core::model::{Background, BackgroundStyle, Grid, Layer, LayerStyle};
use cartographer_core::{ImageFormat, Map, RenderOptions, load_yaml, render_image, render_svg, validate};
use std::path::PathBuf;

#[derive(thiserror::Error, Debug)]
enum CmdError {
    #[error("{0}")]
    Core(#[from] cartographer_core::Error),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("yaml: {0}")]
    Yaml(#[from] serde_yaml::Error),
    #[error("unsupported extension `.{0}` (expected svg, png, jpg)")]
    BadExt(String),
}

impl serde::Serialize for CmdError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

#[tauri::command]
fn load_map(path: String) -> Result<Map, CmdError> {
    let yaml = std::fs::read_to_string(&path)?;
    Ok(load_yaml(&yaml)?)
}

#[tauri::command]
fn parse_map(yaml: String) -> Result<Map, CmdError> {
    Ok(load_yaml(&yaml)?)
}

#[derive(serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RenderArgs {
    show_grid: Option<bool>,
    /// `[x, y, width, height]` in pixel units. Editor uses this to lock the
    /// viewbox to its canvas dimensions.
    viewbox: Option<[f64; 4]>,
    transparent_background: Option<bool>,
    /// Show layers tagged `gm_only`. Default true (GM view).
    show_gm: Option<bool>,
}

#[tauri::command]
fn render_map_svg(map: Map, args: Option<RenderArgs>) -> Result<String, CmdError> {
    let args = args.unwrap_or_default();
    let opts = RenderOptions {
        show_grid: args.show_grid.unwrap_or(true),
        viewbox: args.viewbox,
        transparent_background: args.transparent_background.unwrap_or(false),
        show_gm: args.show_gm.unwrap_or(true),
        ..Default::default()
    };
    Ok(render_svg(&map, &opts))
}

#[tauri::command]
fn new_map() -> Map {
    Map {
        version: 1,
        grid: Grid::default(),
        background: Background { style: BackgroundStyle::Ink },
        layers: vec![
            Layer {
                id: "main".into(),
                style: LayerStyle::default(),
                carves: vec![],
                walls: vec![],
                objects: vec![],
                gm_only: false,
            },
            Layer {
                id: "secrets".into(),
                style: LayerStyle::default(),
                carves: vec![],
                walls: vec![],
                objects: vec![],
                gm_only: true,
            },
        ],
        notes: vec![],
    }
}

#[tauri::command]
fn save_map(map: Map, path: String) -> Result<(), CmdError> {
    validate::validate(&map)?;
    let yaml = serde_yaml::to_string(&map)?;
    std::fs::write(&path, yaml)?;
    Ok(())
}

#[derive(serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ExportArgs {
    /// Include layers marked `gm_only`. Default true (GM view).
    show_gm: Option<bool>,
}

#[tauri::command]
fn export_image(map: Map, path: String, args: Option<ExportArgs>) -> Result<(), CmdError> {
    let args = args.unwrap_or_default();
    let p = PathBuf::from(&path);
    let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase();
    let opts = RenderOptions {
        show_gm: args.show_gm.unwrap_or(true),
        ..Default::default()
    };
    let svg = render_svg(&map, &opts);
    let bytes = match ext.as_str() {
        "svg" => svg.into_bytes(),
        "png" => render_image(&svg, ImageFormat::Png)?,
        "jpg" | "jpeg" => render_image(&svg, ImageFormat::Jpeg)?,
        other => return Err(CmdError::BadExt(other.into())),
    };
    std::fs::write(&p, bytes)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            load_map,
            parse_map,
            render_map_svg,
            new_map,
            save_map,
            export_image,
        ])
        .run(tauri::generate_context!())
        .expect("error running cartographer-tauri");
}
