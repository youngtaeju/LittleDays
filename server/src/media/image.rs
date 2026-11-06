//! 사진 디코드와 파생물(WebP·AVIF), blurhash, 대표색. 전부 동기 CPU 작업. 호출 측 `spawn_blocking`.

use std::{
    borrow::Cow,
    fs::{self, File},
    io::BufReader,
    path::Path,
};

use ::image::{
    DynamicImage, ImageDecoder, ImageFormat, ImageReader, RgbImage, RgbaImage,
    metadata::Orientation,
};
use anyhow::{Context, anyhow, bail};
use fast_image_resize::{
    FilterType, PixelType, ResizeAlg, ResizeOptions, Resizer,
    images::{Image, ImageRef},
};
use libheif_rs::{
    Channel, ColorSpace, CompressionFormat, EncoderParameterValue, EncoderQuality, HeifContext,
    LibHeif, RgbChroma,
};
use moxcms::{ColorProfile, Layout, TransformOptions};
use serde::{Deserialize, Serialize};

use super::sniff::MediaType;

const THUMB_LONG: u32 = 400;
const PREVIEW_LONG: u32 = 1600;
const LARGE_LONG: u32 = 2560;
const THUMB_QUALITY: f32 = 75.0;
const PREVIEW_QUALITY: f32 = 80.0;
const LARGE_QUALITY: f32 = 80.0;
const WEBP_METHOD: i32 = 4;
const AVIF_QUALITY: u8 = 50;
const AVIF_SPEED: i32 = 6;

/// `assets.derivatives` jsonb 형태. 파일명 `<variant>.<format>`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Derivatives {
    pub thumb: VariantInfo,
    pub preview: VariantInfo,
    pub large: VariantInfo,
    /// 영상 재생본. 사진은 `None`.
    pub playback: Option<VariantInfo>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VariantInfo {
    pub width: u32,
    pub height: u32,
    pub formats: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct Rendered {
    pub derivatives: Derivatives,
    /// 입력(회전 후) 크기.
    pub width: u32,
    pub height: u32,
    pub blurhash: String,
    /// `#rrggbb`.
    pub dominant_color: String,
}

/// 회전·ICC→sRGB 적용 후 RGB8. 알파는 흰 배경에 합성.
/// `orientation` 은 EXIF 값. HEIC/HEIF/AVIF 는 libheif 가 irot/imir 를 적용하므로 무시.
pub fn decode(path: &Path, ty: MediaType, orientation: u32) -> anyhow::Result<RgbImage> {
    match ty {
        MediaType::Jpeg => decode_raster(path, ImageFormat::Jpeg, orientation),
        MediaType::Png => decode_raster(path, ImageFormat::Png, orientation),
        MediaType::Webp => decode_raster(path, ImageFormat::WebP, orientation),
        MediaType::Heic | MediaType::Heif | MediaType::Avif => decode_heif(path),
        MediaType::Mp4 | MediaType::Mov | MediaType::Webm => bail!("not an image: {ty:?}"),
    }
}

fn decode_raster(path: &Path, format: ImageFormat, orientation: u32) -> anyhow::Result<RgbImage> {
    let file = File::open(path).with_context(|| format!("open {}", path.display()))?;
    let mut decoder = ImageReader::with_format(BufReader::new(file), format).into_decoder()?;
    // 프로파일 읽기 실패는 색 변환 생략.
    let icc = decoder.icc_profile().ok().flatten();
    let img = DynamicImage::from_decoder(decoder)?;
    let mut rgb = if img.color().has_alpha() {
        flatten(&img.into_rgba8())
    } else {
        img.into_rgb8()
    };
    if let Some(icc) = icc {
        to_srgb(&mut rgb, &icc);
    }
    Ok(rotate(rgb, orientation))
}

fn decode_heif(path: &Path) -> anyhow::Result<RgbImage> {
    let name = path
        .to_str()
        .ok_or_else(|| anyhow!("non UTF-8 path: {}", path.display()))?;
    let lib = LibHeif::new();
    let ctx = HeifContext::read_from_file(name)?;
    let handle = ctx.primary_image_handle()?;
    let alpha = handle.has_alpha_channel();
    let chroma = if alpha {
        RgbChroma::Rgba
    } else {
        RgbChroma::Rgb
    };
    // irot/imir/clap 적용. EXIF Orientation 재적용 금지.
    let decoded = lib.decode(&handle, ColorSpace::Rgb(chroma), None)?;
    let plane = decoded
        .planes()
        .interleaved
        .ok_or_else(|| anyhow!("heif: no interleaved plane"))?;
    let channels: u32 = if alpha { 4 } else { 3 };
    if u32::from(plane.storage_bits_per_pixel) != channels * 8 {
        bail!("heif: unexpected {} bpp", plane.storage_bits_per_pixel);
    }
    let row = (plane.width * channels) as usize;
    let mut px = Vec::with_capacity(row * plane.height as usize);
    for y in 0..plane.height as usize {
        let start = y * plane.stride;
        px.extend_from_slice(&plane.data[start..start + row]);
    }
    let mut rgb = if alpha {
        let rgba = RgbaImage::from_raw(plane.width, plane.height, px)
            .ok_or_else(|| anyhow!("heif: buffer size mismatch"))?;
        flatten(&rgba)
    } else {
        RgbImage::from_raw(plane.width, plane.height, px)
            .ok_or_else(|| anyhow!("heif: buffer size mismatch"))?
    };
    // nclx 전용 색 정보는 미처리.
    if let Some(icc) = handle.color_profile_raw() {
        to_srgb(&mut rgb, &icc.data);
    }
    Ok(rgb)
}

/// 흰 배경 위 알파 합성.
fn flatten(rgba: &RgbaImage) -> RgbImage {
    RgbImage::from_fn(rgba.width(), rgba.height(), |x, y| {
        let [r, g, b, a] = rgba.get_pixel(x, y).0;
        let a = u32::from(a);
        let mix = |c: u8| ((u32::from(c) * a + 255 * (255 - a) + 127) / 255) as u8;
        ::image::Rgb([mix(r), mix(g), mix(b)])
    })
}

/// 임베디드 ICC → sRGB. 프로파일 해석·변환 실패(손상, CMYK 등)는 경고 후 원래 값 유지.
fn to_srgb(img: &mut RgbImage, icc: &[u8]) {
    let transform = ColorProfile::new_from_slice(icc).and_then(|src| {
        src.create_transform_8bit(
            Layout::Rgb,
            &ColorProfile::new_srgb(),
            Layout::Rgb,
            TransformOptions::default(),
        )
    });
    let mut out = vec![0u8; img.as_raw().len()];
    match transform.and_then(|t| t.transform(img.as_raw(), &mut out)) {
        Ok(()) => img.copy_from_slice(&out),
        Err(e) => tracing::warn!(error = ?e, "ICC 변환 생략"),
    }
}

fn rotate(img: RgbImage, orientation: u32) -> RgbImage {
    let Some(o) = u8::try_from(orientation)
        .ok()
        .and_then(Orientation::from_exif)
    else {
        return img;
    };
    let mut d = DynamicImage::ImageRgb8(img);
    d.apply_orientation(o);
    d.into_rgb8()
}

/// 파생물 생성. `out_dir` 생성, 기존 파일 덮어씀.
/// 체인 large → preview → thumb, 원본보다 크게 늘리지 않음. 파생물에 ICC 없음(sRGB 가정).
pub fn render(img: &RgbImage, out_dir: &Path, avif: bool) -> anyhow::Result<Rendered> {
    fs::create_dir_all(out_dir).with_context(|| format!("create {}", out_dir.display()))?;
    let mut resizer = Resizer::new();
    let large = shrink(&mut resizer, img, LARGE_LONG)?;
    let preview = shrink(&mut resizer, &large, PREVIEW_LONG)?;
    let thumb = shrink(&mut resizer, &preview, THUMB_LONG)?;

    write_webp(&large, LARGE_QUALITY, &out_dir.join("large.webp"))?;
    write_webp(&preview, PREVIEW_QUALITY, &out_dir.join("preview.webp"))?;
    write_webp(&thumb, THUMB_QUALITY, &out_dir.join("thumb.webp"))?;
    let mut preview_formats = vec!["webp".to_string()];
    if avif {
        write_avif(&preview, &out_dir.join("preview.avif"))?;
        preview_formats.push("avif".to_string());
    }

    let info = |i: &RgbImage, formats: Vec<String>| VariantInfo {
        width: i.width(),
        height: i.height(),
        formats,
    };
    Ok(Rendered {
        derivatives: Derivatives {
            thumb: info(&thumb, vec!["webp".to_string()]),
            preview: info(&preview, preview_formats),
            large: info(&large, vec!["webp".to_string()]),
            playback: None,
        },
        width: img.width(),
        height: img.height(),
        blurhash: blurhash(&thumb)?,
        dominant_color: dominant_color(&thumb),
    })
}

/// 긴 변 `long` 이하로 Lanczos3 축소. 이미 작으면 그대로.
fn shrink<'a>(
    resizer: &mut Resizer,
    src: &'a RgbImage,
    long: u32,
) -> anyhow::Result<Cow<'a, RgbImage>> {
    let (w, h) = src.dimensions();
    if w.max(h) <= long {
        return Ok(Cow::Borrowed(src));
    }
    let scaled =
        |a: u32, b: u32| ((f64::from(a) * f64::from(long) / f64::from(b)).round() as u32).max(1);
    let (dw, dh) = if w >= h {
        (long, scaled(h, w))
    } else {
        (scaled(w, h), long)
    };
    let src_img = ImageRef::new(w, h, src.as_raw(), PixelType::U8x3)?;
    let mut dst = Image::new(dw, dh, PixelType::U8x3);
    resizer.resize(
        &src_img,
        &mut dst,
        &ResizeOptions::new().resize_alg(ResizeAlg::Convolution(FilterType::Lanczos3)),
    )?;
    let out = RgbImage::from_raw(dw, dh, dst.into_vec())
        .ok_or_else(|| anyhow!("resize: buffer size mismatch"))?;
    Ok(Cow::Owned(out))
}

fn write_webp(img: &RgbImage, quality: f32, path: &Path) -> anyhow::Result<()> {
    let mut config = webp::WebPConfig::new().map_err(|()| anyhow!("webp: config init"))?;
    config.quality = quality;
    config.method = WEBP_METHOD;
    let encoded = webp::Encoder::from_rgb(img.as_raw(), img.width(), img.height())
        .encode_advanced(&config)
        .map_err(|e| anyhow!("webp: {e:?}"))?;
    fs::write(path, &*encoded).with_context(|| format!("write {}", path.display()))
}

/// libheif + aom 플러그인. 다른 AV1 인코더(rav1e, svt)가 있어도 aom 고정.
fn write_avif(img: &RgbImage, path: &Path) -> anyhow::Result<()> {
    let lib = LibHeif::new();
    let descriptor = lib
        .encoder_descriptors(16, Some(CompressionFormat::Av1), None)
        .into_iter()
        .find(|d| d.id() == "aom")
        .ok_or_else(|| anyhow!("avif: aom encoder plugin not found"))?;
    let mut encoder = lib.encoder(descriptor)?;
    encoder.set_quality(EncoderQuality::Lossy(AVIF_QUALITY))?;
    encoder.set_parameter_value("speed", EncoderParameterValue::Int(AVIF_SPEED))?;

    let (w, h) = img.dimensions();
    let mut heif_img = libheif_rs::Image::new(w, h, ColorSpace::Rgb(RgbChroma::Rgb))?;
    heif_img.create_plane(Channel::Interleaved, w, h, 8)?;
    let mut planes = heif_img.planes_mut();
    let plane = planes
        .interleaved
        .as_mut()
        .ok_or_else(|| anyhow!("avif: no interleaved plane"))?;
    let row = w as usize * 3;
    for (y, src) in img.as_raw().chunks_exact(row).enumerate() {
        let start = y * plane.stride;
        plane.data[start..start + row].copy_from_slice(src);
    }

    let mut ctx = HeifContext::new()?;
    ctx.encode_image(&heif_img, &mut encoder, None)?;
    let bytes = ctx.write_to_bytes()?;
    fs::write(path, bytes).with_context(|| format!("write {}", path.display()))
}

/// 4x3 성분.
fn blurhash(thumb: &RgbImage) -> anyhow::Result<String> {
    let rgba = DynamicImage::ImageRgb8(thumb.clone()).into_rgba8();
    ::blurhash::encode(4, 3, thumb.width(), thumb.height(), rgba.as_raw())
        .map_err(|e| anyhow!("blurhash: {e:?}"))
}

/// 채널당 16단계 히스토그램의 최빈 구간 평균색.
fn dominant_color(thumb: &RgbImage) -> String {
    let mut count = vec![0u64; 4096];
    let mut sum = vec![[0u64; 3]; 4096];
    for p in thumb.pixels() {
        let [r, g, b] = p.0;
        let bin = usize::from(r >> 4) << 8 | usize::from(g >> 4) << 4 | usize::from(b >> 4);
        count[bin] += 1;
        for (s, c) in sum[bin].iter_mut().zip(p.0) {
            *s += u64::from(c);
        }
    }
    let (bin, n) = count
        .iter()
        .enumerate()
        .max_by_key(|&(_, n)| *n)
        .map_or((0, 1), |(i, n)| (i, (*n).max(1)));
    let [r, g, b] = sum[bin].map(|s| ((s + n / 2) / n) as u8);
    format!("#{r:02x}{g:02x}{b:02x}")
}
