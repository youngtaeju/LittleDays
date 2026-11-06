//! 영상 메타 읽기, 재생 방식 판단, 포스터 추출, remux/변환. ffmpeg/ffprobe 서브프로세스 사용.

use std::{ffi::OsString, path::Path, process::Stdio};

use anyhow::{Context, Result, anyhow, bail};
use chrono::{DateTime, Utc};
use image::RgbImage;
use serde_json::Value;
use tokio::process::Command;

use super::sniff::MediaType;

const MAX_LONG_SIDE: u32 = 1920;

#[derive(Debug, Clone, PartialEq)]
pub struct Probe {
    pub duration_ms: Option<i64>,
    /// 회전 반영한 표시 크기.
    pub width: u32,
    pub height: u32,
    pub video_codec: String,
    pub pix_fmt: Option<String>,
    pub audio_codec: Option<String>,
    pub creation_time: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Playback {
    /// 원본 그대로 재생.
    Direct,
    /// 코덱은 유지, 컨테이너만 MP4 로.
    Remux,
    Transcode,
}

fn parse_time(s: &str) -> Option<DateTime<Utc>> {
    // 애플 형식 `+0900` 은 RFC 3339 가 아니므로 별도 파싱.
    DateTime::parse_from_rfc3339(s)
        .or_else(|_| DateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S%z"))
        .ok()
        .map(|t| t.with_timezone(&Utc))
}

fn secs_to_ms(v: &Value) -> Option<i64> {
    let secs: f64 = v.as_str()?.parse().ok()?;
    (secs.is_finite() && secs >= 0.0).then(|| (secs * 1000.0).round() as i64)
}

fn rotation(stream: &Value) -> i64 {
    let from_side = stream["side_data_list"]
        .as_array()
        .and_then(|l| l.iter().find_map(|d| d["rotation"].as_f64()));
    let deg = from_side.or_else(|| {
        stream["tags"]["rotate"]
            .as_str()
            .and_then(|s| s.parse::<f64>().ok())
    });
    deg.map_or(0, |d| d.round() as i64)
}

pub fn parse_probe(json: &str) -> Result<Probe> {
    let v: Value = serde_json::from_str(json).context("ffprobe 출력 파싱 실패")?;
    let streams = v["streams"].as_array().map(Vec::as_slice).unwrap_or(&[]);
    let codec_type = |s: &&Value, t: &str| s["codec_type"].as_str() == Some(t);
    let video = streams
        .iter()
        .find(|s| codec_type(s, "video"))
        .ok_or_else(|| anyhow!("영상 스트림 없음"))?;
    let audio = streams.iter().find(|s| codec_type(s, "audio"));

    let (mut width, mut height) = (
        video["width"].as_u64().unwrap_or(0) as u32,
        video["height"].as_u64().unwrap_or(0) as u32,
    );
    if width == 0 || height == 0 {
        bail!("영상 크기 없음");
    }
    if rotation(video).rem_euclid(180) == 90 {
        std::mem::swap(&mut width, &mut height);
    }

    let fmt_tags = &v["format"]["tags"];
    let creation_time = fmt_tags["com.apple.quicktime.creationdate"]
        .as_str()
        .and_then(parse_time)
        .or_else(|| fmt_tags["creation_time"].as_str().and_then(parse_time))
        .or_else(|| video["tags"]["creation_time"].as_str().and_then(parse_time));

    Ok(Probe {
        duration_ms: secs_to_ms(&v["format"]["duration"])
            .or_else(|| secs_to_ms(&video["duration"])),
        width,
        height,
        video_codec: video["codec_name"].as_str().unwrap_or_default().to_owned(),
        pix_fmt: video["pix_fmt"].as_str().map(str::to_owned),
        audio_codec: audio.and_then(|a| a["codec_name"].as_str().map(str::to_owned)),
        creation_time,
    })
}

/// 서브프로세스 실행. 실패 시 stderr 마지막 비어있지 않은 줄을 에러에 포함.
async fn run(program: &str, args: Vec<OsString>) -> Result<Vec<u8>> {
    let out = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .kill_on_drop(true)
        .output()
        .await
        .with_context(|| format!("{program} 실행 실패"))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let last = stderr
            .lines()
            .rev()
            .find(|l| !l.trim().is_empty())
            .unwrap_or("");
        bail!("{program} 실패 ({}): {last}", out.status);
    }
    Ok(out.stdout)
}

fn os_args(strs: &[&str]) -> Vec<OsString> {
    strs.iter().map(OsString::from).collect()
}

pub async fn probe(path: &Path) -> Result<Probe> {
    let mut args = os_args(&[
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
    ]);
    args.push(path.into());
    let out = run("ffprobe", args).await?;
    parse_probe(&String::from_utf8_lossy(&out))
}

pub fn playback_plan(ty: MediaType, p: &Probe) -> Playback {
    let audio_ok = matches!(p.audio_codec.as_deref(), None | Some("aac"));
    let codec_ok = p.video_codec == "h264" && p.pix_fmt.as_deref() == Some("yuv420p") && audio_ok;
    match (codec_ok, ty) {
        (true, MediaType::Mp4) => Playback::Direct,
        (true, MediaType::Mov) => Playback::Remux,
        _ => Playback::Transcode,
    }
}

/// 위치 `min(1000, duration/2)` ms 의 프레임. ffmpeg 자동 회전으로 표시 방향.
pub async fn extract_poster(path: &Path, duration_ms: Option<i64>) -> Result<RgbImage> {
    let pos_ms = duration_ms.map_or(0, |d| (d / 2).clamp(0, 1000));
    let pos = format!("{}.{:03}", pos_ms / 1000, pos_ms % 1000);
    let mut args = os_args(&["-v", "error", "-ss", &pos, "-i"]);
    args.push(path.into());
    args.extend(os_args(&[
        "-frames:v",
        "1",
        "-f",
        "image2pipe",
        "-c:v",
        "png",
        "-",
    ]));
    let png = run("ffmpeg", args).await?;
    if png.is_empty() {
        bail!("포스터 프레임 없음");
    }
    Ok(image::load_from_memory(&png)
        .context("포스터 디코드 실패")?
        .into_rgb8())
}

pub async fn make_playback(src: &Path, dst: &Path, plan: Playback) -> Result<()> {
    let mut args = os_args(&["-v", "error", "-y", "-i"]);
    args.push(src.into());
    // 데이터 트랙 등 MP4 비호환 스트림 제외.
    args.extend(os_args(&["-map", "0:v:0", "-map", "0:a:0?"]));
    match plan {
        Playback::Direct => return Ok(()),
        Playback::Remux => args.extend(os_args(&["-c", "copy"])),
        Playback::Transcode => {
            // 긴 변 1920 이하로만 축소, 짝수 크기 유지.
            let scale = format!(
                "scale=w='if(gt(iw,ih),min({m},trunc(iw/2)*2),-2)':h='if(gt(iw,ih),-2,min({m},trunc(ih/2)*2))'",
                m = MAX_LONG_SIDE
            );
            args.extend(os_args(&[
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
                "-vf", &scale, "-c:a", "aac", "-b:a", "128k",
            ]));
        }
    }
    args.extend(os_args(&["-movflags", "+faststart", "-f", "mp4"]));
    args.push(dst.into());
    run("ffmpeg", args).await.map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> String {
        let p = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/probe")
            .join(name);
        std::fs::read_to_string(p).unwrap()
    }

    fn at(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    #[test]
    fn parse_probe_cases() {
        let p = parse_probe(&fixture("h264.json")).unwrap();
        assert_eq!((p.width, p.height), (160, 120));
        assert_eq!(p.video_codec, "h264");
        assert_eq!(p.pix_fmt.as_deref(), Some("yuv420p"));
        assert_eq!(p.audio_codec.as_deref(), Some("aac"));
        assert!((1950..=2050).contains(&p.duration_ms.unwrap()));
        assert_eq!(p.creation_time, Some(at("2024-06-01T03:00:00Z")));

        let p = parse_probe(&fixture("hevc-rotated.json")).unwrap();
        assert_eq!((p.width, p.height), (120, 160));

        let p = parse_probe(&fixture("apple-creationdate.json")).unwrap();
        assert_eq!((p.width, p.height), (1080, 1920));
        assert_eq!(p.creation_time, Some(at("2024-05-01T01:20:30Z")));
    }

    #[test]
    fn parse_probe_legacy_rotate_tag() {
        let json = r#"{"streams":[{"codec_type":"video","codec_name":"h264","width":640,"height":360,"tags":{"rotate":"270"}}],"format":{}}"#;
        let p = parse_probe(json).unwrap();
        assert_eq!((p.width, p.height), (360, 640));
        assert_eq!(p.duration_ms, None);
    }

    #[test]
    fn parse_probe_without_video_fails() {
        assert!(parse_probe(r#"{"streams":[{"codec_type":"audio"}],"format":{}}"#).is_err());
    }

    #[test]
    fn playback_plan_matrix() {
        let probe = |codec: &str, pix: &str, audio: Option<&str>| Probe {
            duration_ms: None,
            width: 160,
            height: 120,
            video_codec: codec.into(),
            pix_fmt: Some(pix.into()),
            audio_codec: audio.map(Into::into),
            creation_time: None,
        };
        use MediaType::*;
        use Playback::*;
        let cases = [
            (Mp4, probe("h264", "yuv420p", Some("aac")), Direct),
            (Mp4, probe("h264", "yuv420p", None), Direct),
            (Mov, probe("h264", "yuv420p", Some("aac")), Remux),
            (Mp4, probe("h264", "yuv420p10le", Some("aac")), Transcode),
            (Mov, probe("hevc", "yuv420p", Some("aac")), Transcode),
            (Webm, probe("vp9", "yuv420p", Some("opus")), Transcode),
            (Mp4, probe("h264", "yuv420p", Some("opus")), Transcode),
        ];
        for (ty, p, want) in cases {
            assert_eq!(playback_plan(ty, &p), want, "{ty:?} {p:?}");
        }
    }
}
