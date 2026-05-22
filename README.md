# cartographer

Open-source old-school D&D dungeon mapper. Two equally-weighted users:

1. **A human GM** drawing maps in a desktop app by drag-to-carve rectangles (rooms), then placing symbols (doors, traps, stairs, altars).
2. **An LLM** authoring or editing the same map files directly, then rendering them.

The map file is a human-readable YAML. The UI mutates it on drag; the LLM writes it from a prompt; one Rust renderer turns it into SVG / PNG / JPG.

## Status

Phase 2 — Tauri shell with read-only preview. You can render maps from the CLI and open a YAML file in the desktop app to preview it. Interactive carve-to-draw editing lands in Phase 3.

## Quick start — CLI

```sh
# Render an example map to JPG
cargo run -p cartographer-cli -- render examples/small-tomb.yaml -o /tmp/out.jpg

# Validate a map file
cargo run -p cartographer-cli -- validate examples/small-tomb.yaml

# Dump the JSON Schema (useful for grounding an LLM)
cargo run -p cartographer-cli -- schema > schema/map.schema.json

# List built-in symbols
cargo run -p cartographer-cli -- symbols
```

## Quick start — desktop app

```sh
# One-time setup
npm install                # installs the Tauri CLI at the workspace root
npm --prefix ui install    # installs the React/Vite frontend deps

# Run the dev app (first run rebuilds the full Rust dep tree, ~minutes)
npm run tauri:dev
```

The app currently lets you `Open YAML…` and shows the rendered map. Edit-on-canvas is Phase 3.

## Map format

See `examples/` for full samples and `examples/README.md` for the LLM cheatsheet.

```yaml
version: 1
grid: { cell_size: 50, ft_per_cell: 5 }
background: { style: parchment }
layers:
  - id: main
    rooms:
      - { id: r1, rect: [0, 0, 6, 4] }
      - { id: r2, rect: [8, 1, 4, 3] }
    corridors:
      - { id: c1, path: [[6, 2], [8, 2]], width: 1 }
    objects:
      - { id: d1, type: door,        at: [6, 2], facing: ew }
      - { id: t1, type: pit-trap,    at: [3, 2] }
      - { id: s1, type: stairs-down, at: [1, 3], facing: n }
```

## License

Dual-licensed under MIT or Apache 2.0, at your option.
