use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::PgExecutor;
use uuid::Uuid;

use super::{Upload, remove_temp_file};
use crate::{
    error::{AppError, AppResult},
    state::AppState,
};

/// 만료는 생성·PATCH 시점부터 24시간.
pub async fn create(
    exec: impl PgExecutor<'_>,
    user_id: Uuid,
    length: i64,
    metadata: &Value,
) -> AppResult<Upload> {
    let upload = sqlx::query_as!(
        Upload,
        "INSERT INTO uploads (id, user_id, length, metadata, expires_at)
         VALUES ($1, $2, $3, $4, now() + interval '24 hours')
         RETURNING id, user_id, length, metadata, expires_at",
        Uuid::now_v7(),
        user_id,
        length,
        metadata,
    )
    .fetch_one(exec)
    .await?;
    Ok(upload)
}

/// 본인 소유·미만료 업로드만.
pub async fn find_for_user(
    exec: impl PgExecutor<'_>,
    id: Uuid,
    user_id: Uuid,
) -> AppResult<Option<Upload>> {
    let upload = sqlx::query_as!(
        Upload,
        "SELECT id, user_id, length, metadata, expires_at FROM uploads
         WHERE id = $1 AND user_id = $2 AND expires_at > now()",
        id,
        user_id,
    )
    .fetch_optional(exec)
    .await?;
    Ok(upload)
}

pub async fn delete(exec: impl PgExecutor<'_>, id: Uuid) -> AppResult<()> {
    sqlx::query!("DELETE FROM uploads WHERE id = $1", id)
        .execute(exec)
        .await?;
    Ok(())
}

/// 새 만료 시각 반환.
pub async fn extend_expiry(exec: impl PgExecutor<'_>, id: Uuid) -> AppResult<DateTime<Utc>> {
    sqlx::query_scalar!(
        "UPDATE uploads SET expires_at = now() + interval '24 hours' WHERE id = $1
         RETURNING expires_at",
        id,
    )
    .fetch_optional(exec)
    .await?
    .ok_or(AppError::NotFound("upload.notFound"))
}

/// 만료 업로드의 임시 파일과 행 삭제. 락 보유 중(진행 중 PATCH·finalize)인 것은 다음 회차로.
/// 파일 삭제 실패 시 행 유지(다음 회차 재시도). 반환은 삭제한 행 수.
pub async fn delete_expired(state: &AppState) -> AppResult<u64> {
    let ids = sqlx::query_scalar!("SELECT id FROM uploads WHERE expires_at <= now()")
        .fetch_all(&state.pool)
        .await?;
    let mut removed = 0;
    for id in ids {
        let Some(_guard) = state.upload_locks.try_acquire(id) else {
            continue;
        };
        if let Err(err) = remove_temp_file(&state.config.data_dir, id).await {
            tracing::warn!(%err, upload_id = %id, "expired upload file removal failed");
            continue;
        }
        // 만료 행은 조회되지 않아 락 보유 중 연장 불가.
        delete(&state.pool, id).await?;
        state.upload_locks.remove(id);
        removed += 1;
    }
    Ok(removed)
}
