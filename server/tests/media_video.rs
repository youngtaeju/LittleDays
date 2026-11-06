use std::path::{Path, PathBuf};

use littledays::media::{
    sniff::MediaType,
    video::{Playback, extract_poster, make_playback, playback_plan, probe},
};
use tempfile::TempDir;
use tokio::process::Command;

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
}

#[tokio::test]
async fn probe_real_files() {
    let h264 = probe(&fixture("clip-h264.mp4")).await.unwrap();
    assert_eq!(playback_plan(MediaType::Mp4, &h264), Playback::Direct);

    let hevc = probe(&fixture("clip-hevc.mov")).await.unwrap();
    assert_eq!(playback_plan(MediaType::Mov, &hevc), Playback::Transcode);
    assert_eq!((hevc.width, hevc.height), (120, 160));
}

#[tokio::test]
async fn poster_respects_rotation() {
    let p = extract_poster(&fixture("clip-h264.mp4"), Some(2000))
        .await
        .unwrap();
    assert_eq!((p.width(), p.height()), (160, 120));

    let p = extract_poster(&fixture("clip-hevc.mov"), Some(2000))
        .await
        .unwrap();
    assert_eq!((p.width(), p.height()), (120, 160));
}

#[tokio::test]
async fn transcode_produces_browser_mp4() {
    let dir = TempDir::new().unwrap();
    let dst = dir.path().join("playback.mp4");
    make_playback(&fixture("clip-hevc.mov"), &dst, Playback::Transcode)
        .await
        .unwrap();

    let p = probe(&dst).await.unwrap();
    assert_eq!(p.video_codec, "h264");
    assert_eq!(p.pix_fmt.as_deref(), Some("yuv420p"));
    assert_eq!(p.audio_codec.as_deref(), Some("aac"));
    assert_eq!((p.width, p.height), (120, 160));
}

#[tokio::test]
async fn remux_copies_streams() {
    let dir = TempDir::new().unwrap();
    let mov = dir.path().join("in.mov");
    let status = Command::new("ffmpeg")
        .args(["-v", "error", "-y", "-i"])
        .arg(fixture("clip-h264.mp4"))
        .args(["-c", "copy", "-f", "mov"])
        .arg(&mov)
        .status()
        .await
        .unwrap();
    assert!(status.success());

    let dst = dir.path().join("playback.mp4");
    make_playback(&mov, &dst, Playback::Remux).await.unwrap();

    let p = probe(&dst).await.unwrap();
    assert_eq!(p.video_codec, "h264");
    let d = p.duration_ms.unwrap();
    assert!((1900..=2100).contains(&d), "duration {d}");
}
