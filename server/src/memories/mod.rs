//! 오늘의 추억. 오늘과 같은 일(day)의 과거 기록 날 중 가장 가까운 년/개월 전 하루.

use chrono::NaiveDate;
use serde::Serialize;
use sqlx::PgExecutor;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{days::DaySummary, error::AppResult};

pub mod routes;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum MemoryKind {
    Years,
    Months,
}

/// 오늘의 추억 하루. `n` 은 `kind` 단위 경과 수.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct Memory {
    pub kind: MemoryKind,
    pub n: i32,
    pub day: DaySummary,
}

/// 추억 후보 날짜. 같은 일(day)의 과거 날 중 정확히 N년 전이 우선(가까운 년),
/// 없으면 11개월 이내(가까운 개월). 말일 보정 없음: 일이 다르면 후보 아님.
/// 기록 날짜 집합은 하루 목록과 같은 규칙.
pub async fn pick(
    exec: impl PgExecutor<'_>,
    tz: &str,
    today: NaiveDate,
    baby_id: Option<Uuid>,
) -> AppResult<Option<(MemoryKind, i32, NaiveDate)>> {
    let row = sqlx::query!(
        r#"WITH f AS (
               SELECT (a.taken_at AT TIME ZONE $1)::date AS date
               FROM assets a
               WHERE a.deleted_at IS NULL
                 AND ($2::uuid IS NULL OR EXISTS (
                       SELECT 1 FROM asset_babies ab WHERE ab.asset_id = a.id AND ab.baby_id = $2))
           ),
           s AS (
               SELECT s.entry_date FROM stories s
               WHERE $2::uuid IS NULL OR EXISTS (
                     SELECT 1 FROM story_babies sb WHERE sb.story_id = s.id AND sb.baby_id = $2)
           ),
           m AS (
               SELECT m.achieved_on FROM milestones m
               WHERE $2::uuid IS NULL OR m.baby_id = $2
           ),
           u AS (
               SELECT f.date FROM f
               UNION
               SELECT s.entry_date FROM s
               UNION
               SELECT m.achieved_on FROM m
           ),
           c AS (
               SELECT u.date,
                      ((date_part('year', $3::date) - date_part('year', u.date)) * 12
                       + date_part('month', $3::date) - date_part('month', u.date))::int
                        AS months_ago
               FROM u
               WHERE u.date < $3::date AND date_part('day', u.date) = date_part('day', $3::date)
           )
           SELECT date AS "date!", months_ago AS "months_ago!" FROM c
           WHERE months_ago % 12 = 0 OR months_ago <= 11
           ORDER BY (months_ago % 12 = 0) DESC, months_ago ASC
           LIMIT 1"#,
        tz,
        baby_id,
        today,
    )
    .fetch_optional(exec)
    .await?;
    Ok(row.map(|r| {
        if r.months_ago % 12 == 0 {
            (MemoryKind::Years, r.months_ago / 12, r.date)
        } else {
            (MemoryKind::Months, r.months_ago, r.date)
        }
    }))
}
