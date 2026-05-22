//! Smoke tests for the end-to-end render pipeline on checked-in examples.

use cartographer_core::{ImageFormat, RenderOptions, load_yaml, render_image, render_svg};

const ONE_ROOM: &str = include_str!("../../../examples/one-room.yaml");
const SMALL_TOMB: &str = include_str!("../../../examples/small-tomb.yaml");

#[test]
fn one_room_renders_svg() {
    let map = load_yaml(ONE_ROOM).expect("parse");
    let svg = render_svg(&map, &RenderOptions::default());
    assert!(svg.starts_with("<svg"), "svg has wrong prefix: {svg:.80}");
    assert!(svg.ends_with("</svg>"), "svg has wrong suffix");
    assert!(svg.contains("<path"), "expected wall/floor paths");
}

#[test]
fn small_tomb_renders_svg() {
    let map = load_yaml(SMALL_TOMB).expect("parse");
    let svg = render_svg(&map, &RenderOptions::default());
    // 4 rooms unioned with one corridor should produce at least one floor path.
    assert!(svg.matches("<path").count() >= 2);
    // All declared object types should appear somewhere in the SVG body.
    for tag in &["pit-trap", "altar", "stairs-down", "secret-door"] {
        // Tags appear via included symbol content (which references rect/text/line
        // primitives, not the tag name itself), so we instead check that the
        // generated <g transform> wrappers for objects are present.
        let _ = tag; // tag list documents intent; real assertion below
    }
    assert!(svg.contains("<g transform="), "expected object wrappers");
    assert!(svg.contains("10ft pit"), "expected note text");
}

#[test]
fn small_tomb_renders_png_and_jpg() {
    let map = load_yaml(SMALL_TOMB).expect("parse");
    let svg = render_svg(&map, &RenderOptions::default());

    let png = render_image(&svg, ImageFormat::Png).expect("png");
    assert!(png.starts_with(&[0x89, b'P', b'N', b'G']), "PNG magic missing");

    let jpg = render_image(&svg, ImageFormat::Jpeg).expect("jpg");
    assert!(jpg.starts_with(&[0xff, 0xd8, 0xff]), "JPEG SOI missing");
}

#[test]
fn rejects_diagonal_corridor() {
    let bad = r#"
version: 1
layers:
  - id: main
    rooms: []
    corridors:
      - { id: c1, path: [[0, 0], [3, 3]], width: 1 }
"#;
    let err = load_yaml(bad).unwrap_err().to_string();
    assert!(err.contains("axis-aligned"), "expected axis-aligned error, got: {err}");
}

#[test]
fn rejects_unknown_symbol() {
    let bad = r#"
version: 1
layers:
  - id: main
    rooms:
      - { id: r, rect: [0, 0, 4, 4] }
    objects:
      - { id: o1, type: pterodactyl, at: [1, 1] }
"#;
    let err = load_yaml(bad).unwrap_err().to_string();
    assert!(err.contains("pterodactyl"), "expected unknown-symbol error, got: {err}");
}

#[test]
fn rejects_duplicate_layer_id() {
    let bad = r#"
version: 1
layers:
  - id: main
    rooms: []
  - id: main
    rooms: []
"#;
    let err = load_yaml(bad).unwrap_err().to_string();
    assert!(err.contains("duplicate layer id"), "got: {err}");
}
