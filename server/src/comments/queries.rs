use chrono::{DateTime, Utc};
use sqlx::PgExecutor;
use uuid::Uuid;

use super::Comment;
use crate::error::AppResult;

/// 오래된 순. `limit` 만큼 가져오며 호출 측이 +1 로 다음 페이지 판정.
pub async fn list(
    exec: impl PgExecutor<'_>,
    asset_id: Uuid,
    cursor: Option<(DateTime<Utc>, Uuid)>,
    limit: i64,
) -> AppResult<Vec<Comment>> {
    let (cursor_ts, cursor_id) = cursor.unzip();
    let rows = sqlx::query_as!(
        Comment,
        "SELECT id, asset_id, author_id, body, created_at, edited_at FROM asset_comments
         WHERE asset_id = $1
           AND ($2::timestamptz IS NULL OR (created_at, id) > ($2, $3))
         ORDER BY created_at, id
         LIMIT $4",
        asset_id,
        cursor_ts,
        cursor_id,
        limit
    )
    .fetch_all(exec)
    .await?;
    Ok(rows)
}

pub async fn insert(
    exec: impl PgExecutor<'_>,
    asset_id: Uuid,
    author_id: Uuid,
    body: &str,
) -> AppResult<Comment> {
    let row = sqlx::query_as!(
        Comment,
        "INSERT INTO asset_comments (id, asset_id, author_id, body) VALUES ($1, $2, $3, $4)
         RETURNING id, asset_id, author_id, body, created_at, edited_at",
        Uuid::now_v7(),
        asset_id,
        author_id,
        body
    )
    .fetch_one(exec)
    .await?;
    Ok(row)
}

/// 사진이 휴지통이면 없는 댓글 취급. 작성자 id 반환.
pub async fn visible_author(exec: impl PgExecutor<'_>, id: Uuid) -> AppResult<Option<Uuid>> {
    let author = sqlx::query_scalar!(
        "SELECT c.author_id FROM asset_comments c JOIN assets a ON a.id = c.asset_id
         WHERE c.id = $1 AND a.deleted_at IS NULL",
        id
    )
    .fetch_optional(exec)
    .await?;
    Ok(author)
}

/// 이미 지워졌으면 `None`.
pub async fn update_body(
    exec: impl PgExecutor<'_>,
    id: Uuid,
    body: &str,
) -> AppResult<Option<Comment>> {
    let row = sqlx::query_as!(
        Comment,
        "UPDATE asset_comments SET body = $2, edited_at = now() WHERE id = $1
         RETURNING id, asset_id, author_id, body, created_at, edited_at",
        id,
        body
    )
    .fetch_optional(exec)
    .await?;
    Ok(row)
}

/// 이미 지워졌으면 `false`.
pub async fn delete(exec: impl PgExecutor<'_>, id: Uuid) -> AppResult<bool> {
    let done = sqlx::query!("DELETE FROM asset_comments WHERE id = $1", id)
        .execute(exec)
        .await?;
    Ok(done.rows_affected() > 0)
}

/// 존재하는 사용자 수.
pub async fn count_users(exec: impl PgExecutor<'_>, ids: &[Uuid]) -> AppResult<i64> {
    let n = sqlx::query_scalar!("SELECT count(*) FROM users WHERE id = ANY($1)", ids)
        .fetch_one(exec)
        .await?;
    Ok(n.unwrap_or(0))
}
