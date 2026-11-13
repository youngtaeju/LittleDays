use axum::{Json, extract::State};
use serde::Deserialize;
use utoipa::IntoParams;
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use super::{Memory, pick};
use crate::{
    auth::extract::CurrentUser,
    days::{self, queries},
    error::{AppResult, ErrorBody},
    request::Query,
    settings,
    state::AppState,
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(get_memory))
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
struct MemoryQuery {
    /// 해당 아기가 태그된 사진과 이야기, 그 아기의 마일스톤만.
    baby_id: Option<Uuid>,
}

#[utoipa::path(
    get,
    path = "/api/memories",
    params(MemoryQuery),
    responses(
        (status = 200, description = "오늘(인스턴스 시간대)과 같은 일의 가장 가까운 년 전, 없으면 11개월 이내 개월 전 하루. 없으면 JSON `null`", body = Option<Memory>),
        (status = 400, description = "쿼리 오류 (`request.invalidQuery`)", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
    )
)]
async fn get_memory(
    State(state): State<AppState>,
    _current: CurrentUser,
    Query(q): Query<MemoryQuery>,
) -> AppResult<Json<Option<Memory>>> {
    let mut tx = state
        .pool
        .begin_with("BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY")
        .await?;
    let tz = settings::queries::load(&mut *tx).await?.timezone;
    let today = sqlx::query_scalar!(r#"SELECT (now() AT TIME ZONE $1)::date AS "today!""#, tz)
        .fetch_one(&mut *tx)
        .await?;
    let Some((kind, n, date)) = pick(&mut *tx, &tz, today, q.baby_id).await? else {
        return Ok(Json(None));
    };
    let mut items =
        queries::list(&mut *tx, &tz, None, q.baby_id, Some(date), Some(date), 1).await?;
    days::fill(&mut tx, &tz, &mut items, q.baby_id).await?;
    tx.commit().await?;
    Ok(Json(items.pop().map(|day| Memory { kind, n, day })))
}
