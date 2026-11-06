use std::path::{Path, PathBuf};

use chrono::{NaiveDate, TimeZone, Utc};
use image::{Rgb, RgbImage};
use littledays::media::{
    exif::{ExifTime, read_meta},
    image::{decode, render},
    sniff::MediaType,
};
use tempfile::TempDir;

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
}

fn px(img: &RgbImage, x: u32, y: u32) -> [u8; 3] {
    img.get_pixel(x, y).0
}

/// Orientation 6 적용 후: 원본 왼쪽 위(빨강)가 오른쪽 위, 원본 오른쪽 아래(파랑)가 왼쪽 아래.
fn assert_rotated_cw(img: &RgbImage) {
    assert_eq!((img.width(), img.height()), (240, 320));
    let [r, _, b] = px(img, 237, 2);
    assert!(
        r > b + 100,
        "오른쪽 위가 빨강 계열이어야 함: {:?}",
        px(img, 237, 2)
    );
    let [r, _, b] = px(img, 2, 317);
    assert!(
        b > r + 100,
        "왼쪽 아래가 파랑 계열이어야 함: {:?}",
        px(img, 2, 317)
    );
}

#[test]
fn orient6_jpeg_is_rotated() {
    let img = decode(&fixture("orient6.jpg"), MediaType::Jpeg, 6).unwrap();
    assert_rotated_cw(&img);
}

#[test]
fn heic_not_double_rotated() {
    let path = fixture("rotated.heic");
    // irot 과 EXIF Orientation 6 동시 보유. EXIF 값을 그대로 넘겨도 회전은 1회.
    let orientation = read_meta(&path).orientation;
    assert_eq!(orientation, 6);
    let img = decode(&path, MediaType::Heic, orientation).unwrap();
    assert_rotated_cw(&img);
}

#[test]
fn png_decodes() {
    let img = decode(&fixture("plain.png"), MediaType::Png, 1).unwrap();
    assert_eq!((img.width(), img.height()), (300, 200));
}

#[test]
fn p3_converted_to_srgb() {
    let img = decode(&fixture("p3.jpg"), MediaType::Jpeg, 1).unwrap();
    let got = px(&img, 32, 32);
    // 기준값: fixtures/README.md 의 vips icc_transform 결과.
    let want = [217u8, 42, 52];
    for c in 0..3 {
        assert!(
            got[c].abs_diff(want[c]) <= 2,
            "중앙 픽셀 {got:?}, 기준 {want:?}"
        );
    }
    assert_ne!(got, [200, 60, 60]);
}

#[test]
fn read_meta_fields() {
    let m = read_meta(&fixture("orient6.jpg"));
    let naive = NaiveDate::from_ymd_opt(2024, 5, 1)
        .unwrap()
        .and_hms_opt(10, 20, 30)
        .unwrap();
    assert_eq!(m.taken_at, Some(ExifTime::Naive(naive)));
    assert_eq!(m.orientation, 6);
    let (lat, lon) = m.gps.unwrap();
    assert!((lat - 37.5665).abs() < 1e-4, "lat {lat}");
    assert!((lon - 126.978).abs() < 1e-4, "lon {lon}");
    assert_eq!(m.camera_make.as_deref(), Some("TestMake"));
    assert_eq!(m.camera_model.as_deref(), Some("TestModel"));

    let m = read_meta(&fixture("offset.jpg"));
    let at = Utc.with_ymd_and_hms(2024, 5, 1, 8, 20, 30).unwrap();
    assert_eq!(m.taken_at, Some(ExifTime::Absolute(at)));

    let m = read_meta(&fixture("plain.png"));
    assert_eq!(m.taken_at, None);
    assert_eq!(m.orientation, 1);
    assert_eq!(m.gps, None);
    assert_eq!(m.camera_make, None);
    assert_eq!(m.camera_model, None);
}

fn gradient(w: u32, h: u32) -> RgbImage {
    RgbImage::from_fn(w, h, |x, y| {
        Rgb([(x * 255 / w) as u8, (y * 255 / h) as u8, 128])
    })
}

fn assert_webp(path: &Path) {
    let bytes = std::fs::read(path).unwrap();
    assert_eq!(&bytes[0..4], b"RIFF", "{}", path.display());
    assert_eq!(&bytes[8..12], b"WEBP", "{}", path.display());
}

#[test]
fn render_sizes_without_upscale() {
    let dir = TempDir::new().unwrap();
    let out = dir.path().join("big");
    let r = render(&gradient(4000, 3000), &out, false).unwrap();
    assert_eq!((r.width, r.height), (4000, 3000));
    let d = &r.derivatives;
    assert_eq!((d.thumb.width, d.thumb.height), (400, 300));
    assert_eq!((d.preview.width, d.preview.height), (1600, 1200));
    assert_eq!((d.large.width, d.large.height), (2560, 1920));
    assert!(d.playback.is_none());
    for v in ["thumb", "preview", "large"] {
        assert_webp(&out.join(format!("{v}.webp")));
    }
    let large = image::open(out.join("large.webp")).unwrap();
    assert_eq!((large.width(), large.height()), (2560, 1920));

    let out = dir.path().join("small");
    let r = render(&gradient(300, 200), &out, false).unwrap();
    let d = &r.derivatives;
    for v in [&d.thumb, &d.preview, &d.large] {
        assert_eq!((v.width, v.height), (300, 200));
        assert_eq!(v.formats, vec!["webp".to_string()]);
    }
}

#[test]
fn render_avif_when_enabled() {
    let dir = TempDir::new().unwrap();
    let img = gradient(800, 600);

    let out = dir.path().join("on");
    let r = render(&img, &out, true).unwrap();
    let bytes = std::fs::read(out.join("preview.avif")).unwrap();
    assert_eq!(&bytes[4..8], b"ftyp");
    assert_eq!(&bytes[8..12], b"avif");
    assert_eq!(r.derivatives.preview.formats, vec!["webp", "avif"]);
    assert_eq!(r.derivatives.thumb.formats, vec!["webp"]);
    assert_eq!(r.derivatives.large.formats, vec!["webp"]);

    let out = dir.path().join("off");
    let r = render(&img, &out, false).unwrap();
    assert!(!out.join("preview.avif").exists());
    assert_eq!(r.derivatives.preview.formats, vec!["webp"]);
}

#[test]
fn blurhash_and_dominant() {
    let dir = TempDir::new().unwrap();
    let img = RgbImage::from_pixel(800, 600, Rgb([200, 40, 40]));
    let r = render(&img, dir.path(), false).unwrap();
    assert_eq!(r.dominant_color, "#c82828");
    assert!(!r.blurhash.is_empty());
}
