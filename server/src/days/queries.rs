use chrono::NaiveDate;
use sqlx::{PgConnection, PgExecutor};
use uuid::Uuid;

use super::{DayDetail, DaySummary};
use crate::{
    assets::{AssetKind, AssetStatus, AssetSummary},
    error::AppResult,
    milestones::{self, MilestoneSummary},
    stories::{self, StorySummary},
};

/// 날짜 내림차순 하루 묶음. `preview`, `stories`, `milestones` 는 비어 있음(호출 측이 채움).
/// 날짜는 사진 촬영일, 이야기 날짜, 마일스톤 달성일 합집합. `cursor` 미만, `from`~`to` 포함 범위.
/// `limit` 만큼 가져오며 호출 측이 +1 로 다음 페이지 판정.
/// `baby_ids` 는 날짜별 집계 조인. 행마다 babies 를 도는 상관 하위 질의는 통계 없는 작은 DB 에서
/// 비용 추정이 JIT 기준 초과(요청마다 JIT 컴파일 수백 ms).
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
        r#"WITH f AS (
               SELECT a.id, a.kind, a.uploaded_by, (a.taken_at AT TIME ZONE $1)::date AS date
               FROM assets a
               WHERE a.deleted_at IS NULL
                 AND ($2::uuid IS NULL OR EXISTS (
                       SELECT 1 FROM asset_babies ab WHERE ab.asset_id = a.id AND ab.baby_id = $2))
           ),
           s AS (
               SELECT s.id, s.entry_date FROM stories s
               WHERE $2::uuid IS NULL OR EXISTS (
                     SELECT 1 FROM story_babies sb WHERE sb.story_id = s.id AND sb.baby_id = $2)
           ),
           m AS (
               SELECT m.baby_id, m.achieved_on FROM milestones m
               WHERE $2::uuid IS NULL OR m.baby_id = $2
           ),
           page AS (
               SELECT u.date
               FROM (
                   SELECT f.date FROM f
                   UNION
                   SELECT s.entry_date FROM s
                   UNION
                   SELECT m.achieved_on FROM m
               ) u
               WHERE ($3::date IS NULL OR u.date < $3)
                 AND ($4::date IS NULL OR u.date >= $4)
                 AND ($5::date IS NULL OR u.date <= $5)
               ORDER BY u.date DESC
               LIMIT $6
           ),
           days AS (
               SELECT f.date,
                      count(*) FILTER (WHERE f.kind = 'photo') AS photo_count,
                      count(*) FILTER (WHERE f.kind = 'video') AS video_count,
                      array_agg(DISTINCT f.uploaded_by) AS uploader_ids,
                      array_agg(f.id) AS asset_ids
               FROM f JOIN page p ON p.date = f.date
               GROUP BY f.date
           ),
           tags AS (
               SELECT d.date, ab.baby_id
               FROM days d JOIN asset_babies ab ON ab.asset_id = ANY(d.asset_ids)
               UNION
               SELECT s.entry_date, sb.baby_id
               FROM s JOIN page p ON p.date = s.entry_date JOIN story_babies sb ON sb.story_id = s.id
               UNION
               SELECT m.achieved_on, m.baby_id FROM m JOIN page p ON p.date = m.achieved_on
           ),
           day_babies AS (
               SELECT t.date, array_agg(b.id ORDER BY b.sort_order, b.created_at, b.id) AS baby_ids
               FROM tags t JOIN babies b ON b.id = t.baby_id
               GROUP BY t.date
           )
           SELECT p.date AS "date!", COALESCE(d.photo_count, 0) AS "photo_count!",
                  COALESCE(d.video_count, 0) AS "video_count!",
                  COALESCE(d.uploader_ids, '{}') AS "uploader_ids!",
                  COALESCE(db.baby_ids, '{}') AS "baby_ids!",
                  (SELECT count(*) FROM asset_likes l WHERE l.asset_id = ANY(d.asset_ids))
                    AS "like_count!",
                  (SELECT count(*) FROM asset_comments c WHERE c.asset_id = ANY(d.asset_ids))
                    AS "comment_count!"
           FROM page p
           LEFT JOIN days d ON d.date = p.date
           LEFT JOIN day_babies db ON db.date = p.date
           ORDER BY p.date DESC"#,
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
            stories: Vec::new(),
            milestones: Vec::new(),
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

/// 그날 개수와 이전, 다음 날. `stories`, `milestones` 는 비어 있음(호출 측이 채움).
/// 그날 사진, 이야기, 마일스톤이 모두 없으면 `None`.
pub async fn detail(
    exec: impl PgExecutor<'_>,
    timezone: &str,
    date: NaiveDate,
    baby_id: Option<Uuid>,
) -> AppResult<Option<DayDetail>> {
    let r = sqlx::query!(
        r#"WITH f AS (
               SELECT a.id, a.kind, a.uploaded_by, (a.taken_at AT TIME ZONE $1)::date AS date
               FROM assets a
               WHERE a.deleted_at IS NULL
                 AND ($3::uuid IS NULL OR EXISTS (
                       SELECT 1 FROM asset_babies ab WHERE ab.asset_id = a.id AND ab.baby_id = $3))
           ),
           n AS (
               SELECT COALESCE(bool_or(u.date = $2), false) AS found,
                      max(u.date) FILTER (WHERE u.date < $2) AS prev_date,
                      min(u.date) FILTER (WHERE u.date > $2) AS next_date
               FROM (
                   SELECT f.date FROM f
                   UNION ALL
                   SELECT s.entry_date FROM stories s
                   WHERE $3::uuid IS NULL OR EXISTS (
                         SELECT 1 FROM story_babies sb WHERE sb.story_id = s.id AND sb.baby_id = $3)
                   UNION ALL
                   SELECT m.achieved_on FROM milestones m WHERE $3::uuid IS NULL OR m.baby_id = $3
               ) u
           ),
           d AS (
               SELECT count(*) FILTER (WHERE f.kind = 'photo') AS photo_count,
                      count(*) FILTER (WHERE f.kind = 'video') AS video_count,
                      array_agg(DISTINCT f.uploaded_by) AS uploader_ids,
                      array_agg(f.id) AS asset_ids
               FROM f WHERE f.date = $2
           )
           SELECT n.found AS "found!", d.photo_count AS "photo_count!",
                  d.video_count AS "video_count!",
                  COALESCE(d.uploader_ids, '{}') AS "uploader_ids!",
                  ARRAY(SELECT b.id FROM babies b
                        WHERE EXISTS (SELECT 1 FROM asset_babies ab
                                      WHERE ab.baby_id = b.id AND ab.asset_id = ANY(d.asset_ids))
                           OR EXISTS (SELECT 1 FROM stories s
                                      JOIN story_babies sb ON sb.story_id = s.id
                                      WHERE sb.baby_id = b.id AND s.entry_date = $2
                                        AND ($3::uuid IS NULL OR EXISTS (
                                              SELECT 1 FROM story_babies fb
                                              WHERE fb.story_id = s.id AND fb.baby_id = $3)))
                           OR EXISTS (SELECT 1 FROM milestones m
                                      WHERE m.baby_id = b.id AND m.achieved_on = $2
                                        AND ($3::uuid IS NULL OR m.baby_id = $3))
                        ORDER BY b.sort_order, b.created_at, b.id) AS "baby_ids!",
                  (SELECT count(*) FROM asset_likes l WHERE l.asset_id = ANY(d.asset_ids))
                    AS "like_count!",
                  (SELECT count(*) FROM asset_comments c WHERE c.asset_id = ANY(d.asset_ids))
                    AS "comment_count!",
                  n.prev_date AS "prev_date?", n.next_date AS "next_date?"
           FROM d, n"#,
        timezone,
        date,
        baby_id,
    )
    .fetch_one(exec)
    .await?;
    if !r.found {
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
        stories: Vec::new(),
        milestones: Vec::new(),
    }))
}

/// 날짜들의 이야기, 마일스톤. 날짜 구분 없이 각각 쓴 시각 오래된 순, 기록 순.
/// 아기 필터는 그 아기 태그 이야기, 그 아기 마일스톤.
pub async fn records(
    conn: &mut PgConnection,
    timezone: &str,
    dates: &[NaiveDate],
    baby_id: Option<Uuid>,
) -> AppResult<(Vec<StorySummary>, Vec<MilestoneSummary>)> {
    let story_ids = sqlx::query_scalar!(
        "SELECT s.id FROM stories s
         WHERE s.entry_date = ANY($1)
           AND ($2::uuid IS NULL OR EXISTS (
                 SELECT 1 FROM story_babies sb WHERE sb.story_id = s.id AND sb.baby_id = $2))",
        dates,
        baby_id
    )
    .fetch_all(&mut *conn)
    .await?;
    let milestone_ids = sqlx::query_scalar!(
        "SELECT id FROM milestones
         WHERE achieved_on = ANY($1) AND ($2::uuid IS NULL OR baby_id = $2)",
        dates,
        baby_id
    )
    .fetch_all(&mut *conn)
    .await?;
    let stories = stories::queries::summaries_for(&mut *conn, timezone, &story_ids).await?;
    let milestones =
        milestones::queries::summaries_for(&mut *conn, timezone, &milestone_ids).await?;
    Ok((stories, milestones))
}
