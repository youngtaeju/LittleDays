use sqlx::{PgConnection, PgExecutor, types::Json};
use uuid::Uuid;

use super::{AgeMonth, AvatarCrop, Baby, BabyInput, BabyStats, Sex};
use crate::{
    assets::{AssetKind, AssetStatus, AssetSummary},
    error::{AppError, AppResult},
};

struct BabyRow {
    id: Uuid,
    name: String,
    birth_date: chrono::NaiveDate,
    sex: Option<Sex>,
    avatar_asset_id: Option<Uuid>,
    avatar_crop: Option<Json<AvatarCrop>>,
    sort_order: i32,
}

impl From<BabyRow> for Baby {
    fn from(r: BabyRow) -> Self {
        Baby {
            id: r.id,
            name: r.name,
            birth_date: r.birth_date,
            sex: r.sex,
            avatar_asset_id: r.avatar_asset_id,
            avatar_crop: r.avatar_crop.map(|c| c.0),
            sort_order: r.sort_order,
        }
    }
}

pub async fn list(exec: impl PgExecutor<'_>) -> AppResult<Vec<Baby>> {
    let babies = sqlx::query_as!(
        BabyRow,
        r#"SELECT id, name, birth_date, sex AS "sex: Sex", avatar_asset_id,
                      avatar_crop AS "avatar_crop: Json<AvatarCrop>", sort_order
           FROM babies ORDER BY sort_order, created_at, id"#
    )
    .fetch_all(exec)
    .await?;
    Ok(babies.into_iter().map(Baby::from).collect())
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
        BabyRow,
        r#"INSERT INTO babies (id, name, birth_date, sex, sort_order)
           VALUES ($1, $2, $3, $4,
                   (SELECT COALESCE(max(sort_order) + 1, 0) FROM babies))
           RETURNING id, name, birth_date, sex AS "sex: Sex", avatar_asset_id,
                      avatar_crop AS "avatar_crop: Json<AvatarCrop>", sort_order"#,
        Uuid::now_v7(),
        input.name,
        input.birth_date,
        input.sex as Option<Sex>,
    )
    .fetch_one(exec)
    .await?;
    Ok(baby.into())
}

/// 존재·`ready`·`photo`·휴지통 아님을 모두 만족하면 `(width, height)`(처리 중 미확정이면 `None`), 아니면 바깥 `None`.
pub async fn valid_avatar_dims(
    exec: impl PgExecutor<'_>,
    asset_id: Uuid,
) -> AppResult<Option<Option<(i32, i32)>>> {
    let row = sqlx::query!(
        "SELECT width, height FROM assets
         WHERE id = $1 AND status = 'ready' AND kind = 'photo' AND deleted_at IS NULL",
        asset_id
    )
    .fetch_optional(exec)
    .await?;
    Ok(row.map(|r| r.width.zip(r.height)))
}

pub async fn replace(
    exec: impl PgExecutor<'_>,
    id: Uuid,
    input: BabyInput,
    avatar_asset_id: Option<Uuid>,
    avatar_crop: Option<AvatarCrop>,
) -> AppResult<Baby> {
    sqlx::query_as!(
        BabyRow,
        r#"UPDATE babies SET name = $2, birth_date = $3, sex = $4, avatar_asset_id = $5,
               avatar_crop = $6
           WHERE id = $1
           RETURNING id, name, birth_date, sex AS "sex: Sex", avatar_asset_id,
                      avatar_crop AS "avatar_crop: Json<AvatarCrop>", sort_order"#,
        id,
        input.name,
        input.birth_date,
        input.sex as Option<Sex>,
        avatar_asset_id,
        avatar_crop.map(Json) as Option<Json<AvatarCrop>>,
    )
    .fetch_optional(exec)
    .await?
    .map(Baby::from)
    .ok_or(AppError::NotFound("babies.notFound"))
}

pub async fn exists(exec: impl PgExecutor<'_>, id: Uuid) -> AppResult<bool> {
    let found = sqlx::query_scalar!(
        r#"SELECT EXISTS(SELECT 1 FROM babies WHERE id = $1) AS "exists!""#,
        id
    )
    .fetch_one(exec)
    .await?;
    Ok(found)
}

/// 트랜잭션 연결 전제. 대표 아기 설정이 이 아기를 가리키면 함께 제거.
pub async fn delete(conn: &mut PgConnection, id: Uuid) -> AppResult<()> {
    sqlx::query!(
        "DELETE FROM settings WHERE key = 'primary_baby_id' AND value = to_jsonb($1::text)",
        id.to_string()
    )
    .execute(&mut *conn)
    .await?;
    let res = sqlx::query!("DELETE FROM babies WHERE id = $1", id)
        .execute(&mut *conn)
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
                                         ORDER BY (g.status = 'ready') DESC,
                                                  g.taken_at DESC, g.id DESC) AS rn
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
