use chrono::NaiveDate;
use sqlx::PgExecutor;
use uuid::Uuid;

use super::GrowthRecord;
use crate::error::AppResult;

/// 아기 생일. 아기 없으면 `None`.
pub async fn baby_birth_date(
    exec: impl PgExecutor<'_>,
    baby_id: Uuid,
) -> AppResult<Option<NaiveDate>> {
    Ok(
        sqlx::query_scalar!("SELECT birth_date FROM babies WHERE id = $1", baby_id)
            .fetch_optional(exec)
            .await?,
    )
}

/// 인스턴스 시간대 오늘 이전(포함)인지.
pub async fn not_future(
    exec: impl PgExecutor<'_>,
    timezone: &str,
    date: NaiveDate,
) -> AppResult<bool> {
    Ok(sqlx::query_scalar!(
        r#"SELECT $2::date <= (now() AT TIME ZONE $1)::date AS "ok!""#,
        timezone,
        date
    )
    .fetch_one(exec)
    .await?)
}

/// 측정일, 같은 날은 만든 순.
pub async fn list(exec: impl PgExecutor<'_>, baby_id: Uuid) -> AppResult<Vec<GrowthRecord>> {
    Ok(sqlx::query_as!(
        GrowthRecord,
        r#"SELECT id, baby_id, measured_on, height_cm::float8 AS height_cm,
                  weight_kg::float8 AS weight_kg, note, created_by, created_at, updated_at
           FROM growth_records WHERE baby_id = $1
           ORDER BY measured_on, created_at, id"#,
        baby_id
    )
    .fetch_all(exec)
    .await?)
}

/// 검증을 마친 입력 값.
pub struct Values<'a> {
    pub measured_on: NaiveDate,
    pub height_cm: Option<f64>,
    pub weight_kg: Option<f64>,
    pub note: Option<&'a str>,
}

pub async fn insert(
    exec: impl PgExecutor<'_>,
    id: Uuid,
    baby_id: Uuid,
    v: Values<'_>,
    created_by: Uuid,
) -> AppResult<GrowthRecord> {
    Ok(sqlx::query_as!(
        GrowthRecord,
        r#"INSERT INTO growth_records
             (id, baby_id, measured_on, height_cm, weight_kg, note, created_by)
           VALUES ($1, $2, $3, $4::float8::numeric(4,1), $5::float8::numeric(5,2), $6, $7)
           RETURNING id, baby_id, measured_on, height_cm::float8 AS height_cm,
                     weight_kg::float8 AS weight_kg, note, created_by, created_at, updated_at"#,
        id,
        baby_id,
        v.measured_on,
        v.height_cm,
        v.weight_kg,
        v.note,
        created_by
    )
    .fetch_one(exec)
    .await?)
}

/// 수정 직전 잠금 조회.
pub async fn lock(exec: impl PgExecutor<'_>, id: Uuid) -> AppResult<Option<GrowthRecord>> {
    Ok(sqlx::query_as!(
        GrowthRecord,
        r#"SELECT id, baby_id, measured_on, height_cm::float8 AS height_cm,
                  weight_kg::float8 AS weight_kg, note, created_by, created_at, updated_at
           FROM growth_records WHERE id = $1 FOR UPDATE"#,
        id
    )
    .fetch_optional(exec)
    .await?)
}

/// 전체 필드 교체. `updated_at` 은 트리거가 없어 직접 갱신.
pub async fn update(exec: impl PgExecutor<'_>, id: Uuid, v: Values<'_>) -> AppResult<GrowthRecord> {
    Ok(sqlx::query_as!(
        GrowthRecord,
        r#"UPDATE growth_records
           SET measured_on = $2, height_cm = $3::float8::numeric(4,1),
               weight_kg = $4::float8::numeric(5,2), note = $5, updated_at = now()
           WHERE id = $1
           RETURNING id, baby_id, measured_on, height_cm::float8 AS height_cm,
                     weight_kg::float8 AS weight_kg, note, created_by, created_at, updated_at"#,
        id,
        v.measured_on,
        v.height_cm,
        v.weight_kg,
        v.note
    )
    .fetch_one(exec)
    .await?)
}

/// 지웠으면 `true`.
pub async fn delete(exec: impl PgExecutor<'_>, id: Uuid) -> AppResult<bool> {
    Ok(sqlx::query!("DELETE FROM growth_records WHERE id = $1", id)
        .execute(exec)
        .await?
        .rows_affected()
        > 0)
}
