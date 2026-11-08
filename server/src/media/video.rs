//! 영상 메타 읽기, 재생 방식 판단, 포스터 추출, remux/변환. ffmpeg/ffprobe 서브프로세스 사용.

use std::{ffi::OsString, path::Path, process::Stdio, sync::OnceLock, time::Duration};

use anyhow::{Context, Result, anyhow, bail};
use chrono::{DateTime, Utc};
use image::RgbImage;
use serde_json::Value;
use tokio::process::Command;

use super::sniff::MediaType;

const MAX_LONG_SIDE: u32 = 1920;

const PROBE_TIMEOUT: Duration = Duration::from_secs(30);
const POSTER_TIMEOUT: Duration = Duration::from_secs(60);
/// 길이를 모를 때 상한.
const UNKNOWN_DURATION_TIMEOUT: Duration = Duration::from_secs(3600);

/// HDR(HLG/PQ) -> SDR(bt709) 톤매핑 필터 체인.
const TONEMAP_FILTER: &str = "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p";

/// 영상 길이만큼 가산. 길이 모르면 상한.
fn scaled_timeout(base_secs: u64, factor: u64, duration_ms: Option<i64>) -> Duration {
    duration_ms.map_or(UNKNOWN_DURATION_TIMEOUT, |ms| {
        Duration::from_secs(base_secs + factor * (ms.max(0) as u64).div_ceil(1000))
    })
}

fn remux_timeout(duration_ms: Option<i64>) -> Duration {
    scaled_timeout(120, 1, duration_ms)
}

fn transcode_timeout(duration_ms: Option<i64>) -> Duration {
    scaled_timeout(300, 4, duration_ms)
}

#[derive(Debug, Clone, PartialEq)]
pub struct Probe {
    pub duration_ms: Option<i64>,
    /// 회전 반영한 표시 크기.
    pub width: u32,
    pub height: u32,
    pub video_codec: String,
    pub pix_fmt: Option<String>,
    pub color_transfer: Option<String>,
    pub color_primaries: Option<String>,
    pub color_space: Option<String>,
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

impl Probe {
    /// 전달 특성이 HDR 이고 primaries/matrix 태그도 있을 때만(없으면 zscale 변환 경로 없음).
    fn is_hdr(&self) -> bool {
        matches!(
            self.color_transfer.as_deref(),
            Some("arib-std-b67" | "smpte2084")
        ) && self.color_primaries.is_some()
            && self.color_space.is_some()
    }
}

pub fn parse_probe(json: &str) -> Result<Probe> {
    let v: Value = serde_json::from_str(json).context("ffprobe output parse failed")?;
    let streams = v["streams"].as_array().map(Vec::as_slice).unwrap_or(&[]);
    let codec_type = |s: &&Value, t: &str| s["codec_type"].as_str() == Some(t);
    let video = streams
        .iter()
        .find(|s| codec_type(s, "video"))
        .ok_or_else(|| anyhow!("no video stream"))?;
    let audio = streams.iter().find(|s| codec_type(s, "audio"));

    let (mut width, mut height) = (
        video["width"].as_u64().unwrap_or(0) as u32,
        video["height"].as_u64().unwrap_or(0) as u32,
    );
    if width == 0 || height == 0 {
        bail!("no video dimensions");
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
        color_transfer: video["color_transfer"].as_str().map(str::to_owned),
        color_primaries: video["color_primaries"].as_str().map(str::to_owned),
        color_space: video["color_space"].as_str().map(str::to_owned),
        audio_codec: audio.and_then(|a| a["codec_name"].as_str().map(str::to_owned)),
        creation_time,
    })
}

/// 서브프로세스 실행. 실패 시 stderr 마지막 비어있지 않은 줄을 에러에 포함.
async fn run(program: &str, args: Vec<OsString>, timeout: Duration) -> Result<Vec<u8>> {
    let mut cmd = Command::new(program);
    cmd.args(args);
    run_with_timeout(cmd, timeout).await
}

/// 타임아웃 초과 시 future drop 으로 자식 kill(`kill_on_drop`).
async fn run_with_timeout(mut cmd: Command, timeout: Duration) -> Result<Vec<u8>> {
    let program = cmd.as_std().get_program().to_string_lossy().into_owned();
    let fut = cmd.stdin(Stdio::null()).kill_on_drop(true).output();
    let out = tokio::time::timeout(timeout, fut)
        .await
        .map_err(|_| anyhow!("{program} timed out after {}s", timeout.as_secs()))?
        .with_context(|| format!("{program} spawn failed"))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let last = stderr
            .lines()
            .rev()
            .find(|l| !l.trim().is_empty())
            .unwrap_or("");
        bail!("{program} failed ({}): {last}", out.status);
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
    let out = run("ffprobe", args, PROBE_TIMEOUT).await?;
    parse_probe(&String::from_utf8_lossy(&out))
}

/// 기동 시 확인. 없으면 영상 처리만 실패하므로 경고만.
pub async fn check_tools() {
    for program in ["ffprobe", "ffmpeg"] {
        if let Err(err) = run(program, os_args(&["-version"]), PROBE_TIMEOUT).await {
            tracing::warn!(program, error = %format!("{err:#}"), "not usable, video processing will fail");
        }
    }
    tonemap_available().await;
}

static TONEMAP_AVAILABLE: OnceLock<bool> = OnceLock::new();

/// zscale/tonemap 필터 지원 여부. 첫 호출 시 한 번 확인 후 캐시(기동 시 미호출이면 지연 확인).
async fn tonemap_available() -> bool {
    if let Some(v) = TONEMAP_AVAILABLE.get() {
        return *v;
    }
    let out = run(
        "ffmpeg",
        os_args(&["-hide_banner", "-filters"]),
        PROBE_TIMEOUT,
    )
    .await
    .map(|o| String::from_utf8_lossy(&o).into_owned())
    .unwrap_or_default();
    let has = |name: &str| {
        out.lines()
            .any(|l| l.split_whitespace().nth(1) == Some(name))
    };
    let ok = has("zscale") && has("tonemap");
    *TONEMAP_AVAILABLE.get_or_init(|| {
        if !ok {
            tracing::warn!("ffmpeg lacks zscale/tonemap, HDR video will not be tone mapped");
        }
        ok
    })
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
pub async fn extract_poster(path: &Path, probe: &Probe) -> Result<RgbImage> {
    let pos_ms = probe.duration_ms.map_or(0, |d| (d / 2).clamp(0, 1000));
    let pos = format!("{}.{:03}", pos_ms / 1000, pos_ms % 1000);
    let mut args = os_args(&["-v", "error", "-ss", &pos, "-i"]);
    args.push(path.into());
    if probe.is_hdr() && tonemap_available().await {
        args.extend(os_args(&["-vf", TONEMAP_FILTER]));
    }
    args.extend(os_args(&[
        "-frames:v",
        "1",
        "-f",
        "image2pipe",
        "-c:v",
        "png",
        "-",
    ]));
    let png = run("ffmpeg", args, POSTER_TIMEOUT).await?;
    if png.is_empty() {
        bail!("no poster frame");
    }
    // PNG 디코드는 CPU 작업. 런타임 밖에서.
    tokio::task::spawn_blocking(move || image::load_from_memory(&png).map(|img| img.into_rgb8()))
        .await
        .context("poster decode task failed")?
        .context("poster decode failed")
}

/// 변환용 비디오 필터. 긴 변 1920 이하로만 축소, 짝수 크기 유지.
/// HDR 은 축소 후 톤매핑(float 단계가 원본 해상도에서 돌지 않게). SDR 은 bt709 태그에 맞게 행렬 변환.
fn transcode_filter(probe: &Probe, tonemap_ok: bool) -> String {
    let scale = format!(
        "scale=w='if(gt(iw,ih),min({m},trunc(iw/2)*2),-2)':h='if(gt(iw,ih),-2,min({m},trunc(ih/2)*2))'",
        m = MAX_LONG_SIDE
    );
    if probe.is_hdr() && tonemap_ok {
        format!("{scale},{TONEMAP_FILTER}")
    } else {
        format!("{scale}:out_color_matrix=bt709:out_range=tv")
    }
}

pub async fn make_playback(src: &Path, dst: &Path, plan: Playback, probe: &Probe) -> Result<()> {
    let mut args = os_args(&["-v", "error", "-y", "-i"]);
    args.push(src.into());
    // 데이터 트랙 등 MP4 비호환 스트림 제외.
    args.extend(os_args(&["-map", "0:v:0", "-map", "0:a:0?"]));
    let mut timeout = remux_timeout(probe.duration_ms);
    match plan {
        Playback::Direct => return Ok(()),
        Playback::Remux => args.extend(os_args(&["-c", "copy"])),
        Playback::Transcode => {
            timeout = transcode_timeout(probe.duration_ms);
            let vf = transcode_filter(probe, tonemap_available().await);
            args.extend(os_args(&[
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "23",
                "-pix_fmt",
                "yuv420p",
                "-vf",
                &vf,
                "-color_primaries",
                "bt709",
                "-color_trc",
                "bt709",
                "-colorspace",
                "bt709",
                "-c:a",
                "aac",
                "-b:a",
                "128k",
            ]));
        }
    }
    args.extend(os_args(&["-movflags", "+faststart", "-f", "mp4"]));
    args.push(dst.into());
    run("ffmpeg", args, timeout).await.map(|_| ())
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
    fn timeouts_scale_with_duration() {
        assert_eq!(remux_timeout(Some(2000)), Duration::from_secs(122));
        assert_eq!(transcode_timeout(Some(10_000)), Duration::from_secs(340));
        assert_eq!(transcode_timeout(None), Duration::from_secs(3600));
    }

    #[test]
    fn parse_probe_color_transfer() {
        let json = r#"{"streams":[{"codec_type":"video","codec_name":"hevc","width":64,"height":64,"color_transfer":"arib-std-b67"}],"format":{}}"#;
        let p = parse_probe(json).unwrap();
        assert_eq!(p.color_transfer.as_deref(), Some("arib-std-b67"));
        // primaries/matrix 태그 없으면 HDR 로 보지 않음.
        assert!(!p.is_hdr());
        let json = r#"{"streams":[{"codec_type":"video","codec_name":"hevc","width":64,"height":64,"color_transfer":"smpte2084","color_primaries":"bt2020","color_space":"bt2020nc"}],"format":{}}"#;
        let p = parse_probe(json).unwrap();
        assert_eq!(p.color_primaries.as_deref(), Some("bt2020"));
        assert_eq!(p.color_space.as_deref(), Some("bt2020nc"));
        assert!(p.is_hdr());
        assert!(!parse_probe(&fixture("h264.json")).unwrap().is_hdr());
    }

    fn hdr_probe(primaries: Option<&str>) -> Probe {
        Probe {
            duration_ms: None,
            width: 3840,
            height: 2160,
            video_codec: "hevc".into(),
            pix_fmt: Some("yuv420p10le".into()),
            color_transfer: Some("arib-std-b67".into()),
            color_primaries: primaries.map(Into::into),
            color_space: Some("bt2020nc".into()),
            audio_codec: None,
            creation_time: None,
        }
    }

    #[test]
    fn transcode_filter_cases() {
        let f = transcode_filter(&hdr_probe(Some("bt2020")), true);
        let (scale, rest) = f.split_once(",zscale").unwrap();
        assert!(scale.starts_with("scale="));
        assert!(!scale.contains("out_color_matrix"));
        assert_eq!(format!("zscale{rest}"), TONEMAP_FILTER);

        let sdr = Probe {
            color_transfer: None,
            ..hdr_probe(Some("bt709"))
        };
        for f in [
            transcode_filter(&sdr, true),
            transcode_filter(&hdr_probe(None), true),
            transcode_filter(&hdr_probe(Some("bt2020")), false),
        ] {
            assert!(f.contains("out_color_matrix=bt709"), "{f}");
            assert!(!f.contains("zscale"), "{f}");
        }
    }

    #[tokio::test]
    async fn stuck_ffmpeg_times_out() {
        let dir = tempfile::TempDir::new().unwrap();
        let marker = dir.path().join("survived");
        let mut cmd = Command::new("sh");
        cmd.arg("-c")
            .arg(format!("sleep 3; touch '{}'", marker.display()));
        let started = std::time::Instant::now();
        let err = run_with_timeout(cmd, Duration::from_secs(1))
            .await
            .unwrap_err();
        assert!(started.elapsed() < Duration::from_secs(2));
        assert!(err.to_string().contains("timed out after 1s"), "{err}");
        // 자식이 kill 됐다면 마커 미생성.
        tokio::time::sleep(Duration::from_secs(3)).await;
        assert!(!marker.exists());
    }

    #[test]
    fn playback_plan_matrix() {
        let probe = |codec: &str, pix: &str, audio: Option<&str>| Probe {
            duration_ms: None,
            width: 160,
            height: 120,
            video_codec: codec.into(),
            pix_fmt: Some(pix.into()),
            color_transfer: None,
            color_primaries: None,
            color_space: None,
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
