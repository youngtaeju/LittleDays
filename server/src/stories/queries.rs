use chrono::{DateTime, NaiveDate, Utc};
use sqlx::{PgConnection, PgExecutor};
use uuid::Uuid;

use super::{Like, Story, StoryComment, StorySummary};
use crate::{
    error::{AppError, AppResult},
    links::{self, LinkKind, PREVIEW_LIMIT},
};

/// 쓴 시각 오래된 순. 없는 id 는 빠짐.
pub async fn summaries_for(
    conn: &mut PgConnection,
    timezone: &str,
    ids: &[Uuid],
) -> AppResult<Vec<StorySummary>> {
    let rows = sqlx::query!(
        r#"SELECT s.id, s.author_id, s.entry_date, s.body, s.created_at, s.edited_at,
                  ARRAY(SELECT b.id FROM story_babies sb JOIN babies b ON b.id = sb.baby_id
                        WHERE sb.story_id = s.id
                        ORDER BY b.sort_order, b.created_at, b.id) AS "baby_ids!",
                  (SELECT count(*) FROM story_assets sa JOIN assets a ON a.id = sa.asset_id
                   WHERE sa.story_id = s.id AND a.deleted_at IS NULL) AS "asset_count!",
                  (SELECT count(*) FROM story_likes l WHERE l.story_id = s.id) AS "like_count!",
                  (SELECT count(*) FROM story_comments c WHERE c.story_id = s.id)
                    AS "comment_count!"
           FROM stories s
           WHERE s.id = ANY($1)
           ORDER BY s.created_at, s.id"#,
        ids,
    )
    .fetch_all(&mut *conn)
    .await?;
    let mut previews = links::assets_for(
        &mut *conn,
        timezone,
        LinkKind::Story,
        ids,
        Some(PREVIEW_LIMIT),
    )
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| StorySummary {
            id: r.id,
            author_id: r.author_id,
            entry_date: r.entry_date,
            body: r.body,
            created_at: r.created_at,
            edited_at: r.edited_at,
            baby_ids: r.baby_ids,
            previews: links::take(&mut previews, r.id),
            asset_count: r.asset_count,
            like_count: r.like_count,
            comment_count: r.comment_count,
        })
        .collect())
}

/// `liked` 는 `viewer` 기준.
pub async fn get(
    conn: &mut PgConnection,
    timezone: &str,
    id: Uuid,
    viewer: Uuid,
) -> AppResult<Option<Story>> {
    let Some(summary) = summaries_for(&mut *conn, timezone, &[id]).await?.pop() else {
        return Ok(None);
    };
    let assets = links::assets_for(&mut *conn, timezone, LinkKind::Story, &[id], None)
        .await?
        .into_iter()
        .map(|(_, a)| a)
        .collect();
    let liked = sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM story_likes WHERE story_id = $1 AND user_id = $2)
             AS "liked!""#,
        id,
        viewer
    )
    .fetch_one(&mut *conn)
    .await?;
    Ok(Some(Story {
        summary,
        assets,
        liked,
    }))
}

/// 작성자 id. 트랜잭션 안에서 행 잠금(동시 수정, 삭제 직렬화).
/// 수정은 `FOR NO KEY UPDATE`(하트/댓글 삽입과 공존), 삭제(`delete = true`)는 `FOR UPDATE`.
pub async fn lock_author(
    exec: impl PgExecutor<'_>,
    id: Uuid,
    delete: bool,
) -> AppResult<Option<Uuid>> {
    let author = if delete {
        sqlx::query_scalar!("SELECT author_id FROM stories WHERE id = $1 FOR UPDATE", id)
            .fetch_optional(exec)
            .await?
    } else {
        sqlx::query_scalar!(
            "SELECT author_id FROM stories WHERE id = $1 FOR NO KEY UPDATE",
            id
        )
        .fetch_optional(exec)
        .await?
    };
    Ok(author)
}

pub async fn insert(
    exec: impl PgExecutor<'_>,
    id: Uuid,
    author_id: Uuid,
    entry_date: NaiveDate,
    body: &str,
) -> AppResult<()> {
    sqlx::query!(
        "INSERT INTO stories (id, author_id, entry_date, body) VALUES ($1, $2, $3, $4)",
        id,
        author_id,
        entry_date,
        body
    )
    .execute(exec)
    .await?;
    Ok(())
}

/// 보낸 필드만 교체. `edited_at` 갱신.
pub async fn update(
    exec: impl PgExecutor<'_>,
    id: Uuid,
    entry_date: Option<NaiveDate>,
    body: Option<&str>,
) -> AppResult<()> {
    sqlx::query!(
        "UPDATE stories SET entry_date = COALESCE($2, entry_date), body = COALESCE($3, body),
                            edited_at = now()
         WHERE id = $1",
        id,
        entry_date,
        body
    )
    .execute(exec)
    .await?;
    Ok(())
}

/// 아기 태그 전체 교체.
pub async fn replace_babies(
    conn: &mut PgConnection,
    story_id: Uuid,
    baby_ids: &[Uuid],
) -> AppResult<()> {
    sqlx::query!("DELETE FROM story_babies WHERE story_id = $1", story_id)
        .execute(&mut *conn)
        .await?;
    sqlx::query!(
        "INSERT INTO story_babies (story_id, baby_id) SELECT $1, unnest($2::uuid[])",
        story_id,
        baby_ids
    )
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// 연결, 반응 행은 cascade.
pub async fn delete(exec: impl PgExecutor<'_>, id: Uuid) -> AppResult<()> {
    sqlx::query!("DELETE FROM stories WHERE id = $1", id)
        .execute(exec)
        .await?;
    Ok(())
}

/// 없으면 404 `story.notFound`. 트랜잭션 안에서 호출 시 커밋까지 삭제 차단(반응 쓰기의 FK 위반 방지).
pub async fn require_exists(exec: impl PgExecutor<'_>, id: Uuid) -> AppResult<()> {
    sqlx::query_scalar!("SELECT id FROM stories WHERE id = $1 FOR KEY SHARE", id)
        .fetch_optional(exec)
        .await?
        .map(|_| ())
        .ok_or(AppError::NotFound("story.notFound"))
}

/// 작성자 id. 트랜잭션 안에서 호출 시 커밋까지 삭제 차단(사진 연결의 FK 위반 방지).
pub async fn author_for_link(exec: impl PgExecutor<'_>, id: Uuid) -> AppResult<Option<Uuid>> {
    let author = sqlx::query_scalar!(
        "SELECT author_id FROM stories WHERE id = $1 FOR KEY SHARE",
        id
    )
    .fetch_optional(exec)
    .await?;
    Ok(author)
}

/// 이미 누른 상태면 그대로(시각 유지).
pub async fn like(exec: impl PgExecutor<'_>, story_id: Uuid, user_id: Uuid) -> AppResult<()> {
    sqlx::query!(
        "INSERT INTO story_likes (story_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        story_id,
        user_id
    )
    .execute(exec)
    .await?;
    Ok(())
}

pub async fn unlike(exec: impl PgExecutor<'_>, story_id: Uuid, user_id: Uuid) -> AppResult<()> {
    sqlx::query!(
        "DELETE FROM story_likes WHERE story_id = $1 AND user_id = $2",
        story_id,
        user_id
    )
    .execute(exec)
    .await?;
    Ok(())
}

/// 최신순.
pub async fn likes(exec: impl PgExecutor<'_>, story_id: Uuid) -> AppResult<Vec<Like>> {
    let rows = sqlx::query_as!(
        Like,
        "SELECT user_id, created_at FROM story_likes WHERE story_id = $1
         ORDER BY created_at DESC, user_id DESC",
        story_id
    )
    .fetch_all(exec)
    .await?;
    Ok(rows)
}

/// 오래된 순. `limit` 만큼 가져오며 호출 측이 +1 로 다음 페이지 판정.
pub async fn list_comments(
    exec: impl PgExecutor<'_>,
    story_id: Uuid,
    cursor: Option<(DateTime<Utc>, Uuid)>,
    limit: i64,
) -> AppResult<Vec<StoryComment>> {
    let (cursor_ts, cursor_id) = cursor.unzip();
    let rows = sqlx::query_as!(
        StoryComment,
        "SELECT id, story_id, author_id, body, created_at, edited_at FROM story_comments
         WHERE story_id = $1
           AND ($2::timestamptz IS NULL OR (created_at, id) > ($2, $3))
         ORDER BY created_at, id
         LIMIT $4",
        story_id,
        cursor_ts,
        cursor_id,
        limit
    )
    .fetch_all(exec)
    .await?;
    Ok(rows)
}

pub async fn insert_comment(
    exec: impl PgExecutor<'_>,
    story_id: Uuid,
    author_id: Uuid,
    body: &str,
) -> AppResult<StoryComment> {
    let row = sqlx::query_as!(
        StoryComment,
        "INSERT INTO story_comments (id, story_id, author_id, body) VALUES ($1, $2, $3, $4)
         RETURNING id, story_id, author_id, body, created_at, edited_at",
        Uuid::now_v7(),
        story_id,
        author_id,
        body
    )
    .fetch_one(exec)
    .await?;
    Ok(row)
}

pub async fn comment_author(exec: impl PgExecutor<'_>, id: Uuid) -> AppResult<Option<Uuid>> {
    let author = sqlx::query_scalar!("SELECT author_id FROM story_comments WHERE id = $1", id)
        .fetch_optional(exec)
        .await?;
    Ok(author)
}

/// 이미 지워졌으면 `None`.
pub async fn update_comment_body(
    exec: impl PgExecutor<'_>,
    id: Uuid,
    body: &str,
) -> AppResult<Option<StoryComment>> {
    let row = sqlx::query_as!(
        StoryComment,
        "UPDATE story_comments SET body = $2, edited_at = now() WHERE id = $1
         RETURNING id, story_id, author_id, body, created_at, edited_at",
        id,
        body
    )
    .fetch_optional(exec)
    .await?;
    Ok(row)
}

/// 이미 지워졌으면 `false`.
pub async fn delete_comment(exec: impl PgExecutor<'_>, id: Uuid) -> AppResult<bool> {
    let done = sqlx::query!("DELETE FROM story_comments WHERE id = $1", id)
        .execute(exec)
        .await?;
    Ok(done.rows_affected() > 0)
}
