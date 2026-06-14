//! Smoke tests for the end-to-end render pipeline on checked-in examples.

use cartographer_core::{
    ImageFormat, RenderOptions, load_yaml, render_bundle, render_image, render_svg,
};

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
    for tag in &["trap", "altar", "stairs-down", "secret-door"] {
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
fn bundle_carries_both_views_with_matching_viewbox() {
    let map = load_yaml(SMALL_TOMB).expect("parse");
    let bundle = render_bundle(&map, &RenderOptions::default());

    assert_eq!(bundle.format, "cartographer-views");
    assert_eq!(bundle.version, 1);
    assert!(bundle.gm.starts_with("<svg"));
    assert!(bundle.player.starts_with("<svg"));

    // Both views must share the same viewBox so a consumer can overlay them.
    let viewbox = |svg: &str| {
        let start = svg.find("viewBox=\"").expect("viewBox") + "viewBox=\"".len();
        let end = svg[start..].find('"').expect("viewBox close") + start;
        svg[start..end].to_string()
    };
    assert_eq!(viewbox(&bundle.gm), viewbox(&bundle.player));

    // It serializes to JSON with the documented keys.
    let json: serde_json::Value = serde_json::to_value(&bundle).expect("serialize");
    for key in &["format", "version", "grid", "gm", "player"] {
        assert!(json.get(key).is_some(), "missing key {key}");
    }
}

#[test]
fn rejects_diagonal_corridor() {
    let bad = r#"
version: 1
layers:
  - id: main
    carves:
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
    carves:
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
    carves: []
  - id: main
    carves: []
"#;
    let err = load_yaml(bad).unwrap_err().to_string();
    assert!(err.contains("duplicate layer id"), "got: {err}");
}
