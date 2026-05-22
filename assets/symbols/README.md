# Symbols

Each `.svg` file in this directory is the inner content of a single symbol
(no `<svg>` wrapper). The renderer wraps each placement in a `<g>` that
translates to the cell coordinate, rotates by the object's facing, and
scales by `cell_size / 100`.

**Coordinate system:** author symbols in a 100×100 box centered at the
origin (`-50..50` on both axes). All dimensions, stroke widths, and font
sizes are in these "symbol units".

Symbols are compiled into the binary via `include_str!`. To add a symbol:

1. Create `assets/symbols/<id>.svg` with the inner content.
2. Add an entry to the `SYMBOLS` table in `crates/cartographer-core/src/symbols.rs`.

The id is the string referenced from map files as `objects[].type`.
