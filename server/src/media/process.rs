//! 자산 처리: 메타데이터, 파생물, 영상 재생본. 워커 전용.

use std::{
    io,
    path::{Path, PathBuf},
};

use anyhow::{Context, bail};
use chrono::{DateTime, NaiveDateTime, Utc};
use serde_json::Value;
use uuid::Uuid;

use super::{
    exif::{self, ExifTime},
    image::{self, Rendered, VariantInfo},
    sniff::MediaType,
    storage,
    video::{self, Playback},
};
use crate::{
    assets::{self, AssetKind, TakenAtSource},
    settings,
    state::AppState,
};

/// 이보다 이른 영상 생성 시각은 자리표시값(1904·1970 기준 0 등)으로 보고 무시. 2000-01-01T00:00:00Z.
const MIN_CREATION_TS: i64 = 946_684_800;

/// 처리 결과. 한 번의 UPDATE 로 `ready` 기록.
struct Processed {
    width: u32,
    height: u32,
    duration_ms: Option<i32>,
    rendered: Rendered,
    gps: Option<(f64, f64)>,
    camera_make: Option<String>,
    camera_model: Option<String>,
    captured: Option<Captured>,
}

/// 메타데이터 촬영 시각.
enum Captured {
    At(DateTime<Utc>, TakenAtSource),
    /// 오프셋 없는 EXIF. 인스턴스 시간대로 SQL 에서 해석.
    NaiveExif(NaiveDateTime),
}

/// 성공 시 자산 `ready`. 실패는 에러로 반환(상태 기록은 호출 측).
/// 자산 행이 없거나 처리 중 사라지면 파생물 정리 후 `Ok`.
pub async fn process_asset(state: &AppState, asset_id: Uuid) -> anyhow::Result<()> {
    let Some(src) = assets::queries::source(&state.pool, asset_id).await? else {
        tracing::info!(%asset_id, "asset gone before processing");
        return Ok(());
    };
    let data_dir = &state.config.data_dir;
    let original = data_dir.join(&src.original_path);
    let ty = original
        .extension()
        .and_then(|ext| ext.to_str())
        .and_then(MediaType::from_ext)
        .with_context(|| format!("unknown original type: {}", src.original_path))?;
    if !tokio::fs::try_exists(&original)
        .await
        .context("check original")?
    {
        bail!("original file missing: {}", src.original_path);
    }
    let settings = settings::queries::load(&state.pool).await?;
    let dir = storage::derivative_dir(data_dir, asset_id);
    // 재처리 시 이전 설정의 파일(예: preview.avif) 잔존 방지.
    remove_dir(&dir)
        .await
        .context("clear previous derivatives")?;

    let processed = match src.kind {
        AssetKind::Photo => photo(original, ty, dir.clone(), settings.derivatives_avif).await?,
        AssetKind::Video => video(&original, ty, &dir, settings.derivatives_avif).await?,
    };
    if !mark_ready(state, asset_id, processed, &settings.timezone).await? {
        remove_orphan_derivatives(state, asset_id).await;
    }
    Ok(())
}

/// 처리 중 행이 사라진 자산의 파생물. 실패는 경고만.
pub async fn remove_orphan_derivatives(state: &AppState, asset_id: Uuid) {
    tracing::info!(%asset_id, "asset gone during processing, removing derivatives");
    let dir = storage::derivative_dir(&state.config.data_dir, asset_id);
    if let Err(err) = remove_dir(&dir).await {
        tracing::warn!(%err, %asset_id, "orphan derivatives removal failed");
    }
}

async fn photo(
    path: PathBuf,
    ty: MediaType,
    dir: PathBuf,
    avif: bool,
) -> anyhow::Result<Processed> {
    let (meta, rendered) = tokio::task::spawn_blocking(move || -> anyhow::Result<_> {
        let meta = exif::read_meta(&path);
        let img = image::decode(&path, ty, meta.orientation).context("decode")?;
        let rendered = image::render(&img, &dir, avif).context("derivatives")?;
        Ok((meta, rendered))
    })
    .await
    .context("photo task")??;
    Ok(Processed {
        width: rendered.width,
        height: rendered.height,
        duration_ms: None,
        rendered,
        gps: meta.gps,
        camera_make: meta.camera_make,
        camera_model: meta.camera_model,
        captured: meta.taken_at.map(|t| match t {
            ExifTime::Absolute(at) => Captured::At(at, TakenAtSource::Exif),
            ExifTime::Naive(naive) => Captured::NaiveExif(naive),
        }),
    })
}

async fn video(path: &Path, ty: MediaType, dir: &Path, avif: bool) -> anyhow::Result<Processed> {
    let probe = video::probe(path).await.context("probe")?;
    let poster = video::extract_poster(path, &probe)
        .await
        .context("poster")?;
    let mut rendered = tokio::task::spawn_blocking({
        let dir = dir.to_path_buf();
        move || image::render(&poster, &dir, avif)
    })
    .await
    .context("poster task")?
    .context("derivatives")?;

    let plan = video::playback_plan(ty, &probe);
    if plan != Playback::Direct {
        let dst = dir.join("playback.mp4");
        // 실패 시 부분 파일이 재생본으로 보이지 않게 임시 이름 경유.
        let tmp = dir.join("playback.mp4.tmp");
        if let Err(err) = video::make_playback(path, &tmp, plan, &probe).await {
            if let Err(rm) = remove_file(&tmp).await {
                tracing::warn!(%rm, path = %tmp.display(), "partial playback removal failed");
            }
            return Err(err.context("playback"));
        }
        tokio::fs::rename(&tmp, &dst)
            .await
            .context("move playback")?;
        let out = video::probe(&dst).await.context("probe playback")?;
        rendered.derivatives.playback = Some(VariantInfo {
            width: out.width,
            height: out.height,
            formats: vec!["mp4".to_string()],
        });
    }

    Ok(Processed {
        width: probe.width,
        height: probe.height,
        duration_ms: probe.duration_ms.and_then(|d| i32::try_from(d).ok()),
        rendered,
        gps: None,
        camera_make: None,
        camera_model: None,
        captured: video_captured(probe.creation_time),
    })
}

fn video_captured(creation_time: Option<DateTime<Utc>>) -> Option<Captured> {
    creation_time
        .filter(|t| t.timestamp() >= MIN_CREATION_TS)
        .map(|t| Captured::At(t, TakenAtSource::VideoMeta))
}

/// 행이 있었으면 `true`. 촬영 시각은 `import`·`manual` 출처면 유지.
async fn mark_ready(
    state: &AppState,
    asset_id: Uuid,
    p: Processed,
    timezone: &str,
) -> anyhow::Result<bool> {
    let (at, naive, source) = match p.captured {
        Some(Captured::At(at, source)) => (Some(at), None, Some(source)),
        Some(Captured::NaiveExif(naive)) => (None, Some(naive), Some(TakenAtSource::Exif)),
        None => (None, None, None),
    };
    let derivatives: Value =
        serde_json::to_value(&p.rendered.derivatives).context("serialize derivatives")?;
    let res = sqlx::query!(
        r#"UPDATE assets SET
             status = 'ready', processing_error = NULL,
             width = $2, height = $3, duration_ms = $4,
             blurhash = $5, dominant_color = $6, derivatives = $7,
             gps_lat = $8, gps_lon = $9, camera_make = $10, camera_model = $11,
             taken_at = CASE
               WHEN taken_at_source IN ('import', 'manual') THEN taken_at
               ELSE COALESCE($12, $13::timestamp AT TIME ZONE $14, taken_at) END,
             taken_at_source = CASE
               WHEN taken_at_source IN ('import', 'manual') THEN taken_at_source
               ELSE COALESCE($15, taken_at_source) END
           WHERE id = $1"#,
        asset_id,
        i32::try_from(p.width).context("width")?,
        i32::try_from(p.height).context("height")?,
        p.duration_ms,
        p.rendered.blurhash,
        p.rendered.dominant_color,
        derivatives,
        p.gps.map(|g| g.0),
        p.gps.map(|g| g.1),
        p.camera_make,
        p.camera_model,
        at,
        naive,
        timezone,
        source as Option<TakenAtSource>,
    )
    .execute(&state.pool)
    .await?;
    Ok(res.rows_affected() == 1)
}

/// 없으면 무시.
async fn remove_dir(dir: &Path) -> io::Result<()> {
    match tokio::fs::remove_dir_all(dir).await {
        Err(err) if err.kind() != io::ErrorKind::NotFound => Err(err),
        _ => Ok(()),
    }
}

/// 없으면 무시.
async fn remove_file(path: &Path) -> io::Result<()> {
    match tokio::fs::remove_file(path).await {
        Err(err) if err.kind() != io::ErrorKind::NotFound => Err(err),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placeholder_video_times_ignored() {
        let at = |s: &str| Some(s.parse::<DateTime<Utc>>().unwrap());
        assert!(video_captured(at("1904-01-01T00:00:00Z")).is_none());
        assert!(video_captured(at("1970-01-01T00:00:00Z")).is_none());
        assert!(video_captured(at("1999-12-31T23:59:59Z")).is_none());
        assert!(video_captured(None).is_none());
        assert!(matches!(
            video_captured(at("2000-01-01T00:00:00Z")),
            Some(Captured::At(_, TakenAtSource::VideoMeta))
        ));
    }
}
