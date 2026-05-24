# cartographer

Old-school D&D dungeon-mapping tool — a desktop app for humans and a YAML format that LLMs can author. Ships as both a graphical editor and a command-line renderer.

Two equally-weighted users:

1. **A human GM** drawing maps in the app by drag-to-carve rectangles (rooms), placing doors / stairs / objects, and writing notes per audience layer.
2. **An LLM** authoring or editing the same YAML directly, then rendering it from the CLI.

The same Rust core renders to SVG / PNG / JPG either way. The map file is a single human-readable YAML — no binary blobs, no auto-generated junk.

## Download

Pre-built artifacts for each release are at the [Releases page](https://github.com/beaurancourt/cartographer/releases/latest):

- **Desktop app** — installers for macOS (`.dmg`), Linux (`.AppImage` / `.deb`), and Windows (`.exe` / `.msi`).
- **Command-line binary** — single executable per platform for terminal use, batch rendering, or LLM pipelines.

## Build from source

```sh
# CLI: target/release/cartographer
cargo build --release -p cartographer-cli

# Desktop app (first run rebuilds the full Rust dep tree)
npm install                       # tauri CLI at the workspace root
npm --prefix ui install           # React/Vite frontend deps
npm run tauri:build               # release bundle in target/release/bundle/
```

For development, `npm run tauri:dev` boots the app with hot-reload.

## CLI usage

```sh
cartographer render examples/small-tomb.yaml -o /tmp/map.png
cartographer render examples/small-tomb.yaml -o /tmp/map.svg --view player
cartographer validate examples/small-tomb.yaml
cartographer symbols                # list built-in object kinds
```

## Desktop app

- **Drag to carve rooms** (rectangle tool). Sub-cell snap via the **Snap** picker (or arrow up/down).
- **Doors / stairs** are anchor-based: click two points (doors) or three (stairs); doors snap to wall segments.
- **Layers**: terrain (shared) / object (shared) / player (player-only) / gm (gm-only). The audience drives what the player-view export sees.
- **Locked doors** show the lock dot in GM view and render as plain doors in Player view. **Secret doors** show an "S" in GM view and a normal door in Player view.
- **Pan** with two-finger scroll / middle-mouse / space-drag. **Zoom** with ⌘+wheel. Canvas is genuinely infinite in every direction.
- **Export** writes two files — `<name>-player.<ext>` and `<name>-gm.<ext>` — so a single click produces both handouts.

## Map format

```yaml
version: 1
grid: { cell_size: 50, ft_per_cell: 5 }
layers:
  - id: terrain
    audience: shared
    carves:
      - { id: r1, rect: [0, 0, 6, 4] }
      - { id: r2, rect: [8, 1, 4, 3] }
      - { id: c1, path: [[6, 2], [8, 2]], width: 1 }     # corridor
  - id: object
    audience: shared
    doors:
      - { id: d1, segment: [[6, 2], [6, 3]] }
    stairs:
      - { id: s1, anchors: [[1, 3], [2, 3], [1, 5]] }
    objects:
      - { id: a1, type: altar, at: [10, 2], facing: n }
  - id: gm
    audience: gm
    notes:
      - { id: n1, at: [3, 2], text: "pressure plate triggers pit" }
```

See `examples/small-tomb.yaml` for a fuller sample.

## How it works

`YAML → Rust model → SVG → (resvg → tiny-skia → image) → PNG/JPG`. The desktop app is a small [Tauri 2](https://v2.tauri.app/) wrapper around the same `cartographer-core` crate the CLI uses, with a React/Vite frontend that round-trips the YAML model through `serde`-typed IPC.

## License

Dual-licensed under [MIT](LICENSE-MIT) or [Apache 2.0](LICENSE-APACHE), at your option.
