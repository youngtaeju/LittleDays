use chrono::NaiveDate;
use sqlx::{PgConnection, PgExecutor};
use uuid::Uuid;

use super::{Milestone, MilestoneSummary};
use crate::{
    error::{AppError, AppResult},
    links::{self, LinkKind, PREVIEW_LIMIT},
};

/// 미리 정한 항목 아기당 한 번 부분 유니크 인덱스.
const PRESET_UNIQUE: &str = "milestones_preset_idx";

/// 미리 정한 항목 중복(23505, `PRESET_UNIQUE`)만 409 `milestone.duplicate`. 그 외는 그대로.
fn map_write_error(e: sqlx::Error) -> AppError {
    let dup = e
        .as_database_error()
        .is_some_and(|d| d.is_unique_violation() && d.constraint() == Some(PRESET_UNIQUE));
    if dup {
        AppError::conflict("milestone.duplicate")
    } else {
        e.into()
    }
}

/// 기록 순(만든 순). 없는 id 는 빠짐.
pub async fn summaries_for(
    conn: &mut PgConnection,
    timezone: &str,
    ids: &[Uuid],
) -> AppResult<Vec<MilestoneSummary>> {
    let rows = sqlx::query!(
        r#"SELECT m.id, m.baby_id, m.preset_key, m.custom_label, m.achieved_on, m.note,
                  (SELECT count(*) FROM milestone_assets ma JOIN assets a ON a.id = ma.asset_id
                   WHERE ma.milestone_id = m.id AND a.deleted_at IS NULL) AS "asset_count!"
           FROM milestones m
           WHERE m.id = ANY($1)
           ORDER BY m.created_at, m.id"#,
        ids,
    )
    .fetch_all(&mut *conn)
    .await?;
    let mut previews = links::assets_for(
        &mut *conn,
        timezone,
        LinkKind::Milestone,
        ids,
        Some(PREVIEW_LIMIT),
    )
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| MilestoneSummary {
            id: r.id,
            baby_id: r.baby_id,
            preset_key: r.preset_key,
            custom_label: r.custom_label,
            achieved_on: r.achieved_on,
            note: r.note,
            previews: links::take(&mut previews, r.id),
            asset_count: r.asset_count,
        })
        .collect())
}

/// 달성일 오래된 순, 같은 날은 만든 순.
pub async fn list_for_baby(
    conn: &mut PgConnection,
    timezone: &str,
    baby_id: Uuid,
) -> AppResult<Vec<MilestoneSummary>> {
    let ids = sqlx::query_scalar!(
        "SELECT id FROM milestones WHERE baby_id = $1 ORDER BY achieved_on, created_at, id",
        baby_id
    )
    .fetch_all(&mut *conn)
    .await?;
    let mut rows = summaries_for(&mut *conn, timezone, &ids).await?;
    // 만든 순 결과를 달성일 기준 안정 정렬.
    rows.sort_by_key(|m| m.achieved_on);
    Ok(rows)
}

pub async fn get(
    conn: &mut PgConnection,
    timezone: &str,
    id: Uuid,
) -> AppResult<Option<Milestone>> {
    let Some(summary) = summaries_for(&mut *conn, timezone, &[id]).await?.pop() else {
        return Ok(None);
    };
    let assets = links::assets_for(&mut *conn, timezone, LinkKind::Milestone, &[id], None)
        .await?
        .into_iter()
        .map(|(_, a)| a)
        .collect();
    let meta = sqlx::query!(
        "SELECT created_by, created_at, updated_at FROM milestones WHERE id = $1",
        id
    )
    .fetch_one(&mut *conn)
    .await?;
    Ok(Some(Milestone {
        summary,
        assets,
        created_by: meta.created_by,
        created_at: meta.created_at,
        updated_at: meta.updated_at,
    }))
}

/// 고치기 전 상태.
pub struct Current {
    pub baby_id: Uuid,
    pub preset_key: Option<String>,
    pub custom_label: Option<String>,
    pub achieved_on: NaiveDate,
    pub note: Option<String>,
}

/// 수정 직전 행 잠금 조회(동시 수정, 삭제 직렬화).
pub async fn lock(exec: impl PgExecutor<'_>, id: Uuid) -> AppResult<Option<Current>> {
    Ok(sqlx::query_as!(
        Current,
        "SELECT baby_id, preset_key, custom_label, achieved_on, note
         FROM milestones WHERE id = $1 FOR UPDATE",
        id
    )
    .fetch_optional(exec)
    .await?)
}

/// 검증을 마친 입력 값.
pub struct Values<'a> {
    pub preset_key: Option<&'a str>,
    pub custom_label: Option<&'a str>,
    pub achieved_on: NaiveDate,
    pub note: Option<&'a str>,
}

/// 같은 아기에 같은 미리 정한 항목이 있으면 409 `milestone.duplicate`.
pub async fn insert(
    exec: impl PgExecutor<'_>,
    id: Uuid,
    baby_id: Uuid,
    v: Values<'_>,
    created_by: Uuid,
) -> AppResult<()> {
    sqlx::query!(
        "INSERT INTO milestones (id, baby_id, preset_key, custom_label, achieved_on, note, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
        id,
        baby_id,
        v.preset_key,
        v.custom_label,
        v.achieved_on,
        v.note,
        created_by
    )
    .execute(exec)
    .await
    .map_err(map_write_error)?;
    Ok(())
}

/// 전체 필드 교체. `updated_at` 은 트리거가 없어 직접 갱신. 중복이면 409 `milestone.duplicate`.
pub async fn update(exec: impl PgExecutor<'_>, id: Uuid, v: Values<'_>) -> AppResult<()> {
    sqlx::query!(
        "UPDATE milestones SET preset_key = $2, custom_label = $3, achieved_on = $4, note = $5,
                               updated_at = now()
         WHERE id = $1",
        id,
        v.preset_key,
        v.custom_label,
        v.achieved_on,
        v.note
    )
    .execute(exec)
    .await
    .map_err(map_write_error)?;
    Ok(())
}

/// 휴지통 아닌 사진 연결 전체 교체, 목록 순서가 위치. 휴지통 사진 연결은 복원 대비 유지.
pub async fn replace_assets(
    conn: &mut PgConnection,
    milestone_id: Uuid,
    asset_ids: &[Uuid],
) -> AppResult<()> {
    sqlx::query!(
        "DELETE FROM milestone_assets ma USING assets a
         WHERE ma.milestone_id = $1 AND a.id = ma.asset_id AND a.deleted_at IS NULL",
        milestone_id
    )
    .execute(&mut *conn)
    .await?;
    // 확인 뒤 휴지통으로 간 사진은 위 삭제에서 빠져 남음. 위치만 갱신.
    sqlx::query!(
        "INSERT INTO milestone_assets (milestone_id, asset_id, position)
         SELECT $1, t.asset_id, (t.n - 1)::int
         FROM unnest($2::uuid[]) WITH ORDINALITY AS t(asset_id, n)
         ON CONFLICT (milestone_id, asset_id) DO UPDATE SET position = EXCLUDED.position",
        milestone_id,
        asset_ids
    )
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// 지웠으면 `true`. 연결은 cascade.
pub async fn delete(exec: impl PgExecutor<'_>, id: Uuid) -> AppResult<bool> {
    Ok(sqlx::query!("DELETE FROM milestones WHERE id = $1", id)
        .execute(exec)
        .await?
        .rows_affected()
        > 0)
}
