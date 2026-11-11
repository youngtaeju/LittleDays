use chrono::NaiveDate;
use sqlx::PgExecutor;
use uuid::Uuid;

use super::{DayDetail, DaySummary};
use crate::{
    assets::{AssetKind, AssetStatus, AssetSummary},
    error::AppResult,
};

/// 날짜 내림차순 하루 묶음. `preview` 는 비어 있음(호출 측이 `previews` 로 채움).
/// `cursor` 미만, `from`~`to` 포함 범위. `limit` 만큼 가져오며 호출 측이 +1 로 다음 페이지 판정.
pub async fn list(
    exec: impl PgExecutor<'_>,
    timezone: &str,
    cursor: Option<NaiveDate>,
    baby_id: Option<Uuid>,
    from: Option<NaiveDate>,
    to: Option<NaiveDate>,
    limit: i64,
) -> AppResult<Vec<DaySummary>> {
    let rows = sqlx::query!(
        r#"WITH days AS (
               SELECT (a.taken_at AT TIME ZONE $1)::date AS date,
                      count(*) FILTER (WHERE a.kind = 'photo') AS photo_count,
                      count(*) FILTER (WHERE a.kind = 'video') AS video_count,
                      array_agg(DISTINCT a.uploaded_by) AS uploader_ids,
                      array_agg(a.id) AS asset_ids
               FROM assets a
               WHERE a.deleted_at IS NULL
                 AND ($2::uuid IS NULL OR EXISTS (
                       SELECT 1 FROM asset_babies ab WHERE ab.asset_id = a.id AND ab.baby_id = $2))
                 AND ($3::date IS NULL OR (a.taken_at AT TIME ZONE $1)::date < $3)
                 AND ($4::date IS NULL OR (a.taken_at AT TIME ZONE $1)::date >= $4)
                 AND ($5::date IS NULL OR (a.taken_at AT TIME ZONE $1)::date <= $5)
               GROUP BY 1
               ORDER BY 1 DESC
               LIMIT $6
           )
           SELECT d.date AS "date!", d.photo_count AS "photo_count!",
                  d.video_count AS "video_count!", d.uploader_ids AS "uploader_ids!",
                  ARRAY(SELECT b.id FROM babies b
                        WHERE EXISTS (SELECT 1 FROM asset_babies ab
                                      WHERE ab.baby_id = b.id AND ab.asset_id = ANY(d.asset_ids))
                        ORDER BY b.sort_order, b.created_at, b.id) AS "baby_ids!",
                  (SELECT count(*) FROM asset_likes l WHERE l.asset_id = ANY(d.asset_ids))
                    AS "like_count!",
                  (SELECT count(*) FROM asset_comments c WHERE c.asset_id = ANY(d.asset_ids))
                    AS "comment_count!"
           FROM days d
           ORDER BY d.date DESC"#,
        timezone,
        baby_id,
        cursor,
        from,
        to,
        limit,
    )
    .fetch_all(exec)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| DaySummary {
            date: r.date,
            photo_count: r.photo_count,
            video_count: r.video_count,
            uploader_ids: r.uploader_ids,
            baby_ids: r.baby_ids,
            like_count: r.like_count,
            comment_count: r.comment_count,
            preview: Vec::new(),
        })
        .collect())
}

/// 날짜별 최신 3장을 한 번에. 날짜 내림차순, 그 안에서 촬영 시각 최신순.
pub async fn previews(
    exec: impl PgExecutor<'_>,
    timezone: &str,
    dates: &[NaiveDate],
    baby_id: Option<Uuid>,
) -> AppResult<Vec<AssetSummary>> {
    let rows = sqlx::query_as!(
        AssetSummary,
        r#"SELECT p.id AS "id!", p.kind AS "kind!: AssetKind", p.status AS "status!: AssetStatus",
                  p.taken_at AS "taken_at!", p.local_date AS "local_date!",
                  p.width, p.height, p.duration_ms, p.blurhash, p.dominant_color,
                  p.uploaded_by AS "uploaded_by!",
                  COALESCE((SELECT array_agg(b.id ORDER BY b.sort_order, b.created_at, b.id)
                            FROM asset_babies ab JOIN babies b ON b.id = ab.baby_id
                            WHERE ab.asset_id = p.id), '{}') AS "baby_ids!",
                  p.derivatives AS "derivatives!"
           FROM (
               SELECT a.id, a.kind, a.status, a.taken_at, a.width, a.height, a.duration_ms,
                      a.blurhash, a.dominant_color, a.uploaded_by, a.derivatives,
                      (a.taken_at AT TIME ZONE $1)::date AS local_date,
                      row_number() OVER (PARTITION BY (a.taken_at AT TIME ZONE $1)::date
                                         ORDER BY a.taken_at DESC, a.id DESC) AS rn
               FROM assets a
               WHERE a.deleted_at IS NULL
                 AND (a.taken_at AT TIME ZONE $1)::date = ANY($2::date[])
                 AND ($3::uuid IS NULL OR EXISTS (
                       SELECT 1 FROM asset_babies ab WHERE ab.asset_id = a.id AND ab.baby_id = $3))
           ) p
           WHERE p.rn <= 3
           ORDER BY p.local_date DESC, p.taken_at DESC, p.id DESC"#,
        timezone,
        dates,
        baby_id,
    )
    .fetch_all(exec)
    .await?;
    Ok(rows)
}

/// 그날 개수와 이전·다음 날. 그날 자산이 없으면 `None`.
pub async fn detail(
    exec: impl PgExecutor<'_>,
    timezone: &str,
    date: NaiveDate,
    baby_id: Option<Uuid>,
) -> AppResult<Option<DayDetail>> {
    let r = sqlx::query!(
        r#"SELECT d.photo_count AS "photo_count!", d.video_count AS "video_count!",
                  COALESCE(d.uploader_ids, '{}') AS "uploader_ids!",
                  ARRAY(SELECT b.id FROM babies b
                        WHERE EXISTS (SELECT 1 FROM asset_babies ab
                                      WHERE ab.baby_id = b.id AND ab.asset_id = ANY(d.asset_ids))
                        ORDER BY b.sort_order, b.created_at, b.id) AS "baby_ids!",
                  (SELECT count(*) FROM asset_likes l WHERE l.asset_id = ANY(d.asset_ids))
                    AS "like_count!",
                  (SELECT count(*) FROM asset_comments c WHERE c.asset_id = ANY(d.asset_ids))
                    AS "comment_count!",
                  d.prev_date AS "prev_date?", d.next_date AS "next_date?"
           FROM (
               SELECT count(*) FILTER (WHERE f.date = $2 AND f.kind = 'photo') AS photo_count,
                      count(*) FILTER (WHERE f.date = $2 AND f.kind = 'video') AS video_count,
                      array_agg(DISTINCT f.uploaded_by) FILTER (WHERE f.date = $2) AS uploader_ids,
                      array_agg(f.id) FILTER (WHERE f.date = $2) AS asset_ids,
                      max(f.date) FILTER (WHERE f.date < $2) AS prev_date,
                      min(f.date) FILTER (WHERE f.date > $2) AS next_date
               FROM (
                   SELECT a.id, a.kind, a.uploaded_by, (a.taken_at AT TIME ZONE $1)::date AS date
                   FROM assets a
                   WHERE a.deleted_at IS NULL
                     AND ($3::uuid IS NULL OR EXISTS (
                           SELECT 1 FROM asset_babies ab
                           WHERE ab.asset_id = a.id AND ab.baby_id = $3))
               ) f
           ) d"#,
        timezone,
        date,
        baby_id,
    )
    .fetch_one(exec)
    .await?;
    if r.photo_count + r.video_count == 0 {
        return Ok(None);
    }
    Ok(Some(DayDetail {
        date,
        photo_count: r.photo_count,
        video_count: r.video_count,
        uploader_ids: r.uploader_ids,
        baby_ids: r.baby_ids,
        like_count: r.like_count,
        comment_count: r.comment_count,
        prev_date: r.prev_date,
        next_date: r.next_date,
    }))
}
