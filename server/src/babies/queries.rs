use sqlx::{PgConnection, PgExecutor};
use uuid::Uuid;

use super::{AgeMonth, Baby, BabyInput, BabyStats, Sex};
use crate::{
    assets::{AssetKind, AssetStatus, AssetSummary},
    error::{AppError, AppResult},
};

pub async fn list(exec: impl PgExecutor<'_>) -> AppResult<Vec<Baby>> {
    let babies = sqlx::query_as!(
        Baby,
        r#"SELECT id, name, birth_date, sex AS "sex: Sex", avatar_asset_id, sort_order
           FROM babies ORDER BY sort_order, created_at, id"#
    )
    .fetch_all(exec)
    .await?;
    Ok(babies)
}

/// 태그 검증용 전체 아기 ID.
pub async fn all_ids(exec: impl PgExecutor<'_>) -> AppResult<Vec<Uuid>> {
    let ids = sqlx::query_scalar!("SELECT id FROM babies")
        .fetch_all(exec)
        .await?;
    Ok(ids)
}

/// `sort_order` 는 현재 최대 + 1.
pub async fn create(exec: impl PgExecutor<'_>, input: BabyInput) -> AppResult<Baby> {
    let baby = sqlx::query_as!(
        Baby,
        r#"INSERT INTO babies (id, name, birth_date, sex, sort_order)
           VALUES ($1, $2, $3, $4,
                   (SELECT COALESCE(max(sort_order) + 1, 0) FROM babies))
           RETURNING id, name, birth_date, sex AS "sex: Sex", avatar_asset_id, sort_order"#,
        Uuid::now_v7(),
        input.name,
        input.birth_date,
        input.sex as Option<Sex>,
    )
    .fetch_one(exec)
    .await?;
    Ok(baby)
}

/// 존재·`ready`·`photo`·휴지통 아님을 모두 만족하는 자산인지.
pub async fn is_valid_avatar(exec: impl PgExecutor<'_>, asset_id: Uuid) -> AppResult<bool> {
    let ok = sqlx::query_scalar!(
        r#"SELECT EXISTS (
               SELECT 1 FROM assets
               WHERE id = $1 AND status = 'ready' AND kind = 'photo' AND deleted_at IS NULL
           ) AS "ok!""#,
        asset_id
    )
    .fetch_one(exec)
    .await?;
    Ok(ok)
}

pub async fn replace(
    exec: impl PgExecutor<'_>,
    id: Uuid,
    input: BabyInput,
    avatar_asset_id: Option<Uuid>,
) -> AppResult<Baby> {
    sqlx::query_as!(
        Baby,
        r#"UPDATE babies SET name = $2, birth_date = $3, sex = $4, avatar_asset_id = $5
           WHERE id = $1
           RETURNING id, name, birth_date, sex AS "sex: Sex", avatar_asset_id, sort_order"#,
        id,
        input.name,
        input.birth_date,
        input.sex as Option<Sex>,
        avatar_asset_id,
    )
    .fetch_optional(exec)
    .await?
    .ok_or(AppError::NotFound("babies.notFound"))
}

pub async fn delete(exec: impl PgExecutor<'_>, id: Uuid) -> AppResult<()> {
    let res = sqlx::query!("DELETE FROM babies WHERE id = $1", id)
        .execute(exec)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("babies.notFound"));
    }
    Ok(())
}

/// 트랜잭션 연결 전제. 전체 집합과 정확히 일치할 때만 `sort_order` 를 0.. 로 재부여.
pub async fn reorder(conn: &mut PgConnection, ids: &[Uuid]) -> AppResult<()> {
    let mut current = sqlx::query_scalar!("SELECT id FROM babies FOR UPDATE")
        .fetch_all(&mut *conn)
        .await?;
    let mut wanted = ids.to_vec();
    current.sort_unstable();
    wanted.sort_unstable();
    if current != wanted {
        return Err(AppError::bad_request("babies.orderMismatch"));
    }
    sqlx::query!(
        "UPDATE babies SET sort_order = (o.ord - 1)::int
         FROM unnest($1::uuid[]) WITH ORDINALITY AS o(id, ord)
         WHERE babies.id = o.id",
        ids
    )
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// 개수와 생후 개월별 묶음. 아기 없으면 `babies.notFound`.
pub async fn stats(
    exec: impl PgExecutor<'_> + Copy,
    id: Uuid,
    timezone: &str,
) -> AppResult<BabyStats> {
    let birth = sqlx::query_scalar!("SELECT birth_date FROM babies WHERE id = $1", id)
        .fetch_optional(exec)
        .await?
        .ok_or(AppError::NotFound("babies.notFound"))?;

    let counts = sqlx::query!(
        r#"SELECT count(*) FILTER (WHERE a.kind = 'photo') AS "photo_count!",
                  count(*) FILTER (WHERE a.kind = 'video') AS "video_count!",
                  count(DISTINCT (a.taken_at AT TIME ZONE $2)::date) AS "day_count!"
           FROM assets a
           JOIN asset_babies ab ON ab.asset_id = a.id AND ab.baby_id = $1
           WHERE a.deleted_at IS NULL"#,
        id,
        timezone,
    )
    .fetch_one(exec)
    .await?;

    // 개월 경계: 생일 + n개월(월말 고정) 이 날짜보다 뒤면 한 달 앞. Postgres `age()` 는 월말 처리가 달라 미사용.
    let rows = sqlx::query!(
        r#"WITH t AS (
               SELECT a.id, a.kind, a.status, a.taken_at, a.width, a.height, a.duration_ms,
                      a.blurhash, a.dominant_color, a.uploaded_by, a.derivatives,
                      (a.taken_at AT TIME ZONE $2)::date AS local_date
               FROM assets a
               JOIN asset_babies ab ON ab.asset_id = a.id AND ab.baby_id = $1
               WHERE a.deleted_at IS NULL
           ), m AS (
               SELECT t.*,
                      ((EXTRACT(year FROM t.local_date) - EXTRACT(year FROM $3::date)) * 12
                       + EXTRACT(month FROM t.local_date) - EXTRACT(month FROM $3::date))::int AS m0
               FROM t
           ), g AS (
               SELECT m.*,
                      CASE WHEN m.local_date < $3::date THEN -1
                           WHEN ($3::date + make_interval(months => m.m0))::date > m.local_date
                               THEN m.m0 - 1
                           ELSE m.m0 END AS age_month
               FROM m
           ), r AS (
               SELECT g.*,
                      count(*) OVER (PARTITION BY g.age_month) AS cnt,
                      row_number() OVER (PARTITION BY g.age_month
                                         ORDER BY g.taken_at DESC, g.id DESC) AS rn
               FROM g
           )
           SELECT r.age_month AS "age_month!", r.cnt AS "count!",
                  CASE WHEN r.age_month < 0 THEN NULL
                       ELSE ($3::date + make_interval(months => r.age_month))::date END AS "from?",
                  CASE WHEN r.age_month < 0 THEN $3::date - 1
                       ELSE ($3::date + make_interval(months => r.age_month + 1))::date - 1
                       END AS "to!",
                  r.id AS "id!", r.kind AS "kind!: AssetKind", r.status AS "status!: AssetStatus",
                  r.taken_at AS "taken_at!", r.local_date AS "local_date!",
                  r.width, r.height, r.duration_ms, r.blurhash, r.dominant_color,
                  r.uploaded_by AS "uploaded_by!",
                  COALESCE((SELECT array_agg(b.id ORDER BY b.sort_order, b.created_at, b.id)
                            FROM asset_babies ab2 JOIN babies b ON b.id = ab2.baby_id
                            WHERE ab2.asset_id = r.id), '{}') AS "baby_ids!",
                  r.derivatives AS "derivatives!"
           FROM r
           WHERE r.rn = 1
           ORDER BY (r.age_month < 0), r.age_month DESC"#,
        id,
        timezone,
        birth,
    )
    .fetch_all(exec)
    .await?;

    Ok(BabyStats {
        photo_count: counts.photo_count,
        video_count: counts.video_count,
        day_count: counts.day_count,
        age_months: rows
            .into_iter()
            .map(|r| AgeMonth {
                age_month: r.age_month,
                count: r.count,
                from: r.from,
                to: r.to,
                cover: AssetSummary {
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
            })
            .collect(),
    })
}
