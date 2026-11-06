//! 휴지통 영구 삭제.

use std::io::ErrorKind;

use uuid::Uuid;

use super::queries;
use crate::{error::AppResult, media::storage, settings, state::AppState};

/// 휴지통 상태인 행만 삭제(태그 cascade, 대표사진 SET NULL, 작업 행 함께 삭제).
/// 커밋 후 원본 파일과 파생물 디렉터리 삭제. 파일 삭제 실패는 경고 로그만. 반환은 삭제한 행 수.
pub async fn purge(state: &AppState, ids: &[Uuid]) -> AppResult<u64> {
    if ids.is_empty() {
        return Ok(0);
    }
    let mut tx = state.pool.begin().await?;
    let removed = queries::delete_trashed(&mut *tx, ids).await?;
    finish_purge(state, tx, removed).await
}

/// jobs 삭제, 커밋, 파일 정리. 삭제 문장은 호출 측.
async fn finish_purge(
    state: &AppState,
    mut tx: sqlx::Transaction<'_, sqlx::Postgres>,
    removed: Vec<queries::Trashed>,
) -> AppResult<u64> {
    let removed_ids: Vec<Uuid> = removed.iter().map(|r| r.id).collect();
    queries::delete_jobs(&mut *tx, &removed_ids).await?;
    tx.commit().await?;

    let data_dir = &state.config.data_dir;
    for row in &removed {
        let original = data_dir.join(&row.original_path);
        if let Err(err) = tokio::fs::remove_file(&original).await
            && err.kind() != ErrorKind::NotFound
        {
            tracing::warn!(%err, asset_id = %row.id, "original removal failed");
        }
        let derivatives = storage::derivative_dir(data_dir, row.id);
        if let Err(err) = tokio::fs::remove_dir_all(&derivatives).await
            && err.kind() != ErrorKind::NotFound
        {
            tracing::warn!(%err, asset_id = %row.id, "derivatives removal failed");
        }
    }
    Ok(removed.len() as u64)
}

/// 보관 기간(`trash_retention_days`)이 지난 휴지통 자산 영구 삭제. 0 이면 자동 삭제 안 함.
pub async fn purge_expired(state: &AppState) -> AppResult<u64> {
    let days = settings::queries::load(&state.pool)
        .await?
        .trash_retention_days;
    if days == 0 {
        return Ok(0);
    }
    let days = i32::try_from(days).unwrap_or(i32::MAX);
    let mut tx = state.pool.begin().await?;
    let removed = queries::delete_expired_trash(&mut *tx, days).await?;
    finish_purge(state, tx, removed).await
}
