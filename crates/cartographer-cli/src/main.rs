use anyhow::{Context, Result, bail};
use cartographer_core::model::View;
use cartographer_core::{ImageFormat, RenderOptions, load_yaml, render_image, render_svg};
use clap::{Parser, Subcommand};
use std::path::PathBuf;
use std::process::ExitCode;

#[derive(Parser)]
#[command(name = "cartographer", version, about = "Render and validate cartographer map files.")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Render a map file to SVG/PNG/JPG (inferred from output extension).
    Render {
        input: PathBuf,
        #[arg(short, long)]
        output: PathBuf,
        /// Override the cell pixel size in the output (in addition to the map's `grid.cell_size`).
        #[arg(long)]
        cell_px: Option<u32>,
        /// Hide the grid overlay.
        #[arg(long)]
        no_grid: bool,
        /// Render the player-facing view: hide layers marked gm_only.
        #[arg(long)]
        player: bool,
    },
    /// Validate a map file. Exits non-zero with a friendly error on failure.
    Validate { input: PathBuf },
    /// Dump the JSON Schema for `Map` (useful for grounding an LLM).
    Schema {
        /// Write to a file instead of stdout.
        #[arg(short, long)]
        output: Option<PathBuf>,
    },
    /// List built-in symbol ids.
    Symbols,
}

fn main() -> ExitCode {
    match Cli::parse().cmd {
        Cmd::Render { input, output, cell_px, no_grid, player } => match render(input, output, cell_px, no_grid, player) {
            Ok(()) => ExitCode::SUCCESS,
            Err(e) => { eprintln!("error: {e:?}"); ExitCode::FAILURE }
        },
        Cmd::Validate { input } => match validate(input) {
            Ok(()) => { println!("ok"); ExitCode::SUCCESS }
            Err(e) => { eprintln!("error: {e}"); ExitCode::FAILURE }
        },
        Cmd::Schema { output } => match schema(output) {
            Ok(()) => ExitCode::SUCCESS,
            Err(e) => { eprintln!("error: {e:?}"); ExitCode::FAILURE }
        },
        Cmd::Symbols => {
            for id in cartographer_core::symbols::known_ids() {
                println!("{id}");
            }
            ExitCode::SUCCESS
        }
    }
}

fn render(
    input: PathBuf,
    output: PathBuf,
    cell_px_override: Option<u32>,
    no_grid: bool,
    player: bool,
) -> Result<()> {
    let yaml = std::fs::read_to_string(&input).with_context(|| format!("reading {}", input.display()))?;
    let mut map = load_yaml(&yaml).with_context(|| format!("loading {}", input.display()))?;
    if let Some(px) = cell_px_override {
        map.grid.cell_size = px;
    }
    let opts = RenderOptions {
        show_grid: !no_grid,
        view: if player { View::Player } else { View::Gm },
        ..Default::default()
    };
    let svg = render_svg(&map, &opts);

    let ext = output
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "svg" => std::fs::write(&output, svg)?,
        "png" => {
            let bytes = render_image(&svg, ImageFormat::Png)?;
            std::fs::write(&output, bytes)?;
        }
        "jpg" | "jpeg" => {
            let bytes = render_image(&svg, ImageFormat::Jpeg)?;
            std::fs::write(&output, bytes)?;
        }
        other => bail!("unsupported output extension `.{other}` (expected svg, png, jpg)"),
    }
    eprintln!("wrote {}", output.display());
    Ok(())
}

fn validate(input: PathBuf) -> Result<()> {
    let yaml = std::fs::read_to_string(&input).with_context(|| format!("reading {}", input.display()))?;
    load_yaml(&yaml).with_context(|| format!("validating {}", input.display()))?;
    Ok(())
}

fn schema(output: Option<PathBuf>) -> Result<()> {
    let schema = cartographer_core::json_schema();
    let pretty = serde_json::to_string_pretty(&schema)?;
    match output {
        Some(path) => std::fs::write(path, pretty)?,
        None => println!("{pretty}"),
    }
    Ok(())
}
