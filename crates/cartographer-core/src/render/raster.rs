//! Rasterize an SVG string to PNG or JPG bytes via resvg + tiny-skia.

use crate::error::{Error, Result};
use image::{ImageEncoder, codecs::jpeg::JpegEncoder, codecs::png::PngEncoder, ExtendedColorType};
use resvg::tiny_skia::{Pixmap, Transform};
use resvg::usvg::{Options as UsvgOptions, Tree};
use std::io::Cursor;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageFormat {
    Png,
    Jpeg,
}

impl ImageFormat {
    pub fn from_extension(ext: &str) -> Option<Self> {
        match ext.to_ascii_lowercase().as_str() {
            "png" => Some(Self::Png),
            "jpg" | "jpeg" => Some(Self::Jpeg),
            _ => None,
        }
    }
}

/// Rasterize the given SVG string and encode it as `format` bytes.
pub fn render_image(svg: &str, format: ImageFormat) -> Result<Vec<u8>> {
    let pixmap = rasterize(svg)?;
    let w = pixmap.width();
    let h = pixmap.height();
    let rgba = pixmap.data();

    let mut out = Cursor::new(Vec::with_capacity(rgba.len() / 2));
    match format {
        ImageFormat::Png => {
            PngEncoder::new(&mut out)
                .write_image(rgba, w, h, ExtendedColorType::Rgba8)?;
        }
        ImageFormat::Jpeg => {
            // JPEG has no alpha; drop A. The renderer always paints an opaque
            // background, so dropping alpha is safe.
            let mut rgb = Vec::with_capacity((w * h * 3) as usize);
            for px in rgba.chunks_exact(4) {
                rgb.extend_from_slice(&px[..3]);
            }
            JpegEncoder::new_with_quality(&mut out, 92)
                .write_image(&rgb, w, h, ExtendedColorType::Rgb8)?;
        }
    }
    Ok(out.into_inner())
}

fn rasterize(svg: &str) -> Result<Pixmap> {
    let mut opts = UsvgOptions::default();
    opts.fontdb_mut().load_system_fonts();
    let tree = Tree::from_str(svg, &opts)
        .map_err(|e| Error::render(format!("usvg parse: {e}")))?;
    let size = tree.size().to_int_size();
    let mut pixmap = Pixmap::new(size.width(), size.height())
        .ok_or_else(|| Error::render("pixmap alloc failed"))?;
    resvg::render(&tree, Transform::default(), &mut pixmap.as_mut());
    Ok(pixmap)
}
