use chrono::{DateTime, Utc};
use sqlx::PgExecutor;
use uuid::Uuid;

use super::Like;
use crate::{
    assets::{AssetKind, AssetStatus, AssetSummary},
    error::AppResult,
};

/// 이미 누른 상태면 그대로(시각 유지).
pub async fn like(exec: impl PgExecutor<'_>, asset_id: Uuid, user_id: Uuid) -> AppResult<()> {
    sqlx::query!(
        "INSERT INTO asset_likes (asset_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        asset_id,
        user_id
    )
    .execute(exec)
    .await?;
    Ok(())
}

pub async fn unlike(exec: impl PgExecutor<'_>, asset_id: Uuid, user_id: Uuid) -> AppResult<()> {
    sqlx::query!(
        "DELETE FROM asset_likes WHERE asset_id = $1 AND user_id = $2",
        asset_id,
        user_id
    )
    .execute(exec)
    .await?;
    Ok(())
}

/// 최신순.
pub async fn likes(exec: impl PgExecutor<'_>, asset_id: Uuid) -> AppResult<Vec<Like>> {
    let rows = sqlx::query_as!(
        Like,
        "SELECT user_id, created_at FROM asset_likes WHERE asset_id = $1
         ORDER BY created_at DESC, user_id DESC",
        asset_id
    )
    .fetch_all(exec)
    .await?;
    Ok(rows)
}

/// 이미 즐겨찾기면 그대로(시각 유지).
pub async fn favorite(exec: impl PgExecutor<'_>, asset_id: Uuid, user_id: Uuid) -> AppResult<()> {
    sqlx::query!(
        "INSERT INTO asset_favorites (asset_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        asset_id,
        user_id
    )
    .execute(exec)
    .await?;
    Ok(())
}

pub async fn unfavorite(exec: impl PgExecutor<'_>, asset_id: Uuid, user_id: Uuid) -> AppResult<()> {
    sqlx::query!(
        "DELETE FROM asset_favorites WHERE asset_id = $1 AND user_id = $2",
        asset_id,
        user_id
    )
    .execute(exec)
    .await?;
    Ok(())
}

/// 내 즐겨찾기. 휴지통 제외, 즐겨찾기 시각 최신순. 항목마다 즐겨찾기 시각(커서용) 동반.
/// `limit` 만큼 가져오며 호출 측이 +1 로 다음 페이지 판정.
pub async fn favorites(
    exec: impl PgExecutor<'_>,
    timezone: &str,
    user_id: Uuid,
    cursor: Option<(DateTime<Utc>, Uuid)>,
    limit: i64,
) -> AppResult<Vec<(DateTime<Utc>, AssetSummary)>> {
    let (cursor_ts, cursor_id) = cursor.unzip();
    let rows = sqlx::query!(
        r#"SELECT a.id, a.kind AS "kind: AssetKind", a.status AS "status: AssetStatus",
                  a.taken_at, (a.taken_at AT TIME ZONE $1)::date AS "local_date!",
                  a.width, a.height, a.duration_ms, a.blurhash, a.dominant_color, a.uploaded_by,
                  COALESCE((SELECT array_agg(b.id ORDER BY b.sort_order, b.created_at, b.id)
                            FROM asset_babies ab JOIN babies b ON b.id = ab.baby_id
                            WHERE ab.asset_id = a.id), '{}') AS "baby_ids!",
                  a.derivatives, f.created_at AS favorited_at
           FROM asset_favorites f JOIN assets a ON a.id = f.asset_id
           WHERE f.user_id = $2
             AND a.deleted_at IS NULL
             AND ($3::timestamptz IS NULL OR (f.created_at, f.asset_id) < ($3, $4::uuid))
           ORDER BY f.created_at DESC, f.asset_id DESC
           LIMIT $5"#,
        timezone,
        user_id,
        cursor_ts,
        cursor_id,
        limit,
    )
    .fetch_all(exec)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| {
            (
                r.favorited_at,
                AssetSummary {
                    id: r.id,
                    kind: r.kind,
                    status: r.status,
                    taken_at: r.taken_at,
                    local_date: r.local_date,
                    width: r.width,
                    height: r.height,
                    duration_ms: r.duration_ms,
                    blurhash: r.blurhash,
                    dominant_color: r.dominant_color,
                    uploaded_by: r.uploaded_by,
                    baby_ids: r.baby_ids,
                    derivatives: r.derivatives,
                },
            )
        })
        .collect())
}
