use chrono::NaiveDate;
use sqlx::{PgConnection, PgExecutor};
use uuid::Uuid;

use super::{PREVIEW_LIMIT, Story, StorySummary};
use crate::{
    assets::{AssetKind, AssetStatus, AssetSummary},
    error::AppResult,
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
    let mut previews = assets_for(&mut *conn, timezone, ids, Some(PREVIEW_LIMIT)).await?;
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
            previews: take_story(&mut previews, r.id),
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
    let assets = assets_for(&mut *conn, timezone, &[id], None)
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

fn take_story(rows: &mut Vec<(Uuid, AssetSummary)>, story_id: Uuid) -> Vec<AssetSummary> {
    let (mine, rest) = std::mem::take(rows)
        .into_iter()
        .partition(|(s, _)| *s == story_id);
    *rows = rest;
    mine.into_iter().map(|(_, a)| a).collect()
}

/// 이야기별 붙인 사진. 휴지통 제외, 위치 순. `limit` 지정 시 이야기당 그 수까지.
async fn assets_for(
    exec: impl PgExecutor<'_>,
    timezone: &str,
    story_ids: &[Uuid],
    limit: Option<i64>,
) -> AppResult<Vec<(Uuid, AssetSummary)>> {
    let rows = sqlx::query!(
        r#"SELECT p.story_id AS "story_id!", p.id AS "id!", p.kind AS "kind!: AssetKind",
                  p.status AS "status!: AssetStatus", p.taken_at AS "taken_at!",
                  p.local_date AS "local_date!", p.width, p.height, p.duration_ms, p.blurhash,
                  p.dominant_color, p.uploaded_by AS "uploaded_by!",
                  COALESCE((SELECT array_agg(b.id ORDER BY b.sort_order, b.created_at, b.id)
                            FROM asset_babies ab JOIN babies b ON b.id = ab.baby_id
                            WHERE ab.asset_id = p.id), '{}') AS "baby_ids!",
                  p.derivatives AS "derivatives!"
           FROM (
               SELECT sa.story_id, sa.position, a.id, a.kind, a.status, a.taken_at, a.width,
                      a.height, a.duration_ms, a.blurhash, a.dominant_color, a.uploaded_by,
                      a.derivatives, (a.taken_at AT TIME ZONE $1)::date AS local_date,
                      row_number() OVER (PARTITION BY sa.story_id
                                         ORDER BY sa.position, a.id) AS rn
               FROM story_assets sa JOIN assets a ON a.id = sa.asset_id
               WHERE sa.story_id = ANY($2) AND a.deleted_at IS NULL
           ) p
           WHERE $3::bigint IS NULL OR p.rn <= $3
           ORDER BY p.story_id, p.position, p.id"#,
        timezone,
        story_ids,
        limit,
    )
    .fetch_all(exec)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| {
            (
                r.story_id,
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

/// 인스턴스 시간대 오늘 이전(오늘 포함)이면 `true`.
pub async fn not_future(
    exec: impl PgExecutor<'_>,
    timezone: &str,
    date: NaiveDate,
) -> AppResult<bool> {
    let ok = sqlx::query_scalar!(
        r#"SELECT $2::date <= (now() AT TIME ZONE $1)::date AS "ok!""#,
        timezone,
        date
    )
    .fetch_one(exec)
    .await?;
    Ok(ok)
}

/// 휴지통 아닌 사진 수. 트랜잭션 안에서 호출 시 커밋까지 완전 삭제 차단(연결 쓰기의 FK 위반 방지).
pub async fn lock_visible_assets(exec: impl PgExecutor<'_>, ids: &[Uuid]) -> AppResult<usize> {
    let found = sqlx::query_scalar!(
        "SELECT id FROM assets WHERE id = ANY($1) AND deleted_at IS NULL FOR KEY SHARE",
        ids
    )
    .fetch_all(exec)
    .await?;
    Ok(found.len())
}

/// 작성자 id. 트랜잭션 안에서 행 잠금(동시 수정, 삭제 직렬화).
pub async fn lock_author(exec: impl PgExecutor<'_>, id: Uuid) -> AppResult<Option<Uuid>> {
    let author = sqlx::query_scalar!("SELECT author_id FROM stories WHERE id = $1 FOR UPDATE", id)
        .fetch_optional(exec)
        .await?;
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

/// 휴지통 아닌 사진 연결 전체 교체, 목록 순서가 위치. 휴지통 사진 연결은 복원 대비 유지.
pub async fn replace_assets(
    conn: &mut PgConnection,
    story_id: Uuid,
    asset_ids: &[Uuid],
) -> AppResult<()> {
    sqlx::query!(
        "DELETE FROM story_assets sa USING assets a
         WHERE sa.story_id = $1 AND a.id = sa.asset_id AND a.deleted_at IS NULL",
        story_id
    )
    .execute(&mut *conn)
    .await?;
    // 확인 뒤 휴지통으로 간 사진은 위 삭제에서 빠져 남음. 위치만 갱신.
    sqlx::query!(
        "INSERT INTO story_assets (story_id, asset_id, position)
         SELECT $1, t.asset_id, (t.n - 1)::int
         FROM unnest($2::uuid[]) WITH ORDINALITY AS t(asset_id, n)
         ON CONFLICT (story_id, asset_id) DO UPDATE SET position = EXCLUDED.position",
        story_id,
        asset_ids
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
