use sqlx::{PgConnection, PgExecutor};
use uuid::Uuid;

use super::{Baby, BabyInput, Sex};
use crate::error::{AppError, AppResult};

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
