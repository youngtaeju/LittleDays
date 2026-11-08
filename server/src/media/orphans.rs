//! `DATA_DIR` 고아 파일 정리. 원본은 삭제하지 않고 `orphans/` 로 이동만.

use std::{
    io,
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};

use uuid::Uuid;

use crate::{error::AppResult, state::AppState};

#[derive(Debug, Default, PartialEq, Eq)]
pub struct SweepReport {
    pub temp_removed: u64,
    pub derivatives_removed: u64,
    pub originals_moved: u64,
}

/// 행이 없고 mtime 이 `older_than` 보다 오래된 파일만 처리.
/// 임시 파일·파생물은 삭제, 원본은 `orphans/originals/YYYY/MM/` 로 이동.
/// 개별 파일 I/O 실패는 경고 후 건너뜀. DB 에러만 전파.
pub async fn sweep(state: &AppState, older_than: Duration) -> AppResult<SweepReport> {
    let data_dir = &state.config.data_dir;
    let cutoff = SystemTime::now().checked_sub(older_than);
    let mut report = SweepReport::default();
    let rel = |path: &Path| {
        path.strip_prefix(data_dir)
            .unwrap_or(path)
            .display()
            .to_string()
    };

    for (id, path) in
        list_uuid_entries(data_dir, &data_dir.join("tmp/uploads"), false, Some("part")).await
    {
        if !is_old(&path, cutoff).await {
            continue;
        }
        let referenced = sqlx::query_scalar!(
            r#"SELECT EXISTS(SELECT 1 FROM uploads WHERE id = $1) AS "exists!""#,
            id
        )
        .fetch_one(&state.pool)
        .await?;
        if referenced {
            continue;
        }
        match tokio::fs::remove_file(&path).await {
            Ok(()) => report.temp_removed += 1,
            Err(err) => tracing::warn!(%err, path = rel(&path), "orphan temp removal failed"),
        }
    }

    // 다른/빈 DB 에 연결된 경우 전부 고아로 오판. 행이 하나도 없으면 두 단계 생략.
    let any_asset = sqlx::query_scalar!(r#"SELECT EXISTS(SELECT 1 FROM assets) AS "exists!""#)
        .fetch_one(&state.pool)
        .await?;
    if !any_asset {
        tracing::warn!("assets table is empty, skipping derivatives and originals sweep");
        return Ok(report);
    }

    for (id, path) in list_uuid_entries(data_dir, &data_dir.join("derivatives"), true, None).await {
        if !is_old(&path, cutoff).await || asset_exists(state, id).await? {
            continue;
        }
        match tokio::fs::remove_dir_all(&path).await {
            Ok(()) => report.derivatives_removed += 1,
            Err(err) => {
                tracing::warn!(%err, path = rel(&path), "orphan derivatives removal failed");
            }
        }
    }

    for (id, path) in list_originals(data_dir, &data_dir.join("originals")).await {
        if !is_old(&path, cutoff).await || asset_exists(state, id).await? {
            continue;
        }
        let Some(dest) = orphan_dest(data_dir, &path) else {
            continue;
        };
        // 이동 직전 재확인. 판정 이후 finalize 가 커밋됐을 가능성 차단.
        if asset_exists(state, id).await? {
            continue;
        }
        match move_original(&path, &dest).await {
            Ok(true) => {
                report.originals_moved += 1;
                tracing::warn!(path = rel(&path), "orphan original moved to orphans/");
            }
            Ok(false) => {
                tracing::warn!(path = rel(&dest), "orphan destination exists, skipped");
            }
            Err(err) => tracing::warn!(%err, path = rel(&path), "orphan original move failed"),
        }
    }
    Ok(report)
}

async fn asset_exists(state: &AppState, id: Uuid) -> AppResult<bool> {
    Ok(sqlx::query_scalar!(
        r#"SELECT EXISTS(SELECT 1 FROM assets WHERE id = $1) AS "exists!""#,
        id
    )
    .fetch_one(&state.pool)
    .await?)
}

/// `cutoff` 없음(기준 시각 언더플로)이면 전부 오래된 것으로 간주. mtime 조회 실패 시 새것으로 취급.
async fn is_old(path: &Path, cutoff: Option<SystemTime>) -> bool {
    let Some(cutoff) = cutoff else { return true };
    match tokio::fs::metadata(path).await.and_then(|m| m.modified()) {
        Ok(modified) => modified < cutoff,
        Err(_) => false,
    }
}

/// `dir` 직속 항목 중 이름이 `<uuid>` 또는 `<uuid>.<ext>` 인 것. `want_dir` 로 디렉터리/파일 선택.
/// 심볼릭 링크와 uuid 가 아닌 이름은 제외. 디렉터리 없으면 빈 목록.
async fn list_uuid_entries(
    data_dir: &Path,
    dir: &Path,
    want_dir: bool,
    ext: Option<&str>,
) -> Vec<(Uuid, PathBuf)> {
    let mut out = Vec::new();
    let Some(mut entries) = read_dir(data_dir, dir).await else {
        return out;
    };
    loop {
        let entry = match entries.next_entry().await {
            Ok(Some(entry)) => entry,
            Ok(None) => break,
            Err(err) => {
                tracing::warn!(%err, "orphan scan dir iteration failed");
                break;
            }
        };
        let Ok(kind) = entry.file_type().await else {
            continue;
        };
        if kind.is_dir() != want_dir || !(kind.is_dir() || kind.is_file()) {
            continue;
        }
        let path = entry.path();
        if let Some(id) = parse_uuid_name(&path, ext) {
            out.push((id, path));
        }
    }
    out
}

/// `originals/YYYY/MM/<uuid>.<ext>` 순회. 연/월 디렉터리 이름은 검사하지 않음.
async fn list_originals(data_dir: &Path, root: &Path) -> Vec<(Uuid, PathBuf)> {
    let mut out = Vec::new();
    for year in subdirs(data_dir, root).await {
        for month in subdirs(data_dir, &year).await {
            out.extend(list_uuid_entries(data_dir, &month, false, Some("*")).await);
        }
    }
    out
}

async fn subdirs(data_dir: &Path, dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Some(mut entries) = read_dir(data_dir, dir).await else {
        return out;
    };
    loop {
        let entry = match entries.next_entry().await {
            Ok(Some(entry)) => entry,
            Ok(None) => break,
            Err(err) => {
                tracing::warn!(%err, "orphan scan dir iteration failed");
                break;
            }
        };
        if entry.file_type().await.is_ok_and(|kind| kind.is_dir()) {
            out.push(entry.path());
        }
    }
    out
}

async fn read_dir(data_dir: &Path, dir: &Path) -> Option<tokio::fs::ReadDir> {
    match tokio::fs::read_dir(dir).await {
        Ok(entries) => Some(entries),
        Err(err) => {
            if err.kind() != io::ErrorKind::NotFound {
                tracing::warn!(%err, path = %dir.strip_prefix(data_dir).unwrap_or(dir).display(), "orphan scan dir read failed");
            }
            None
        }
    }
}

/// `ext` 가 `Some("*")` 면 확장자 필수(임의 값), `Some(x)` 면 `x` 일치, `None` 이면 확장자 없어야 함.
fn parse_uuid_name(path: &Path, ext: Option<&str>) -> Option<Uuid> {
    let stem = path.file_stem()?.to_str()?;
    let actual = path.extension().and_then(|e| e.to_str());
    match (ext, actual) {
        (None, None) => {}
        (Some("*"), Some(_)) => {}
        (Some(want), Some(got)) if want == got => {}
        _ => return None,
    }
    // 표준 하이픈 표기만 인정.
    let id = Uuid::try_parse(stem).ok()?;
    (id.hyphenated().to_string() == stem).then_some(id)
}

/// `originals/YYYY/MM/<파일>` → `orphans/originals/YYYY/MM/<파일>`.
fn orphan_dest(data_dir: &Path, original: &Path) -> Option<PathBuf> {
    let rel = original.strip_prefix(data_dir.join("originals")).ok()?;
    Some(data_dir.join("orphans/originals").join(rel))
}

/// 대상이 이미 있으면 덮어쓰지 않고 `Ok(false)`.
async fn move_original(src: &Path, dest: &Path) -> io::Result<bool> {
    if tokio::fs::try_exists(dest).await? {
        return Ok(false);
    }
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    tokio::fs::rename(src, dest).await?;
    Ok(true)
}
