use axum::{Json, extract::State};
use chrono::NaiveDate;
use serde::Deserialize;
use utoipa::IntoParams;
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use super::{DayDetail, DaySummary, queries};
use crate::{
    assets::Page,
    auth::extract::CurrentUser,
    error::{AppError, AppResult, ErrorBody},
    request::{Path, Query},
    settings,
    state::AppState,
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(list_days))
        .routes(routes!(get_day))
}

const DEFAULT_LIMIT: i64 = 20;
const MAX_LIMIT: i64 = 100;

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
struct DaysQuery {
    /// 이전 응답의 `next_cursor`. 이 날짜보다 이전 날만.
    cursor: Option<NaiveDate>,
    /// 1~100, 기본 20.
    limit: Option<i64>,
    /// 해당 아기가 태그된 사진과 이야기, 그 아기의 마일스톤만.
    baby_id: Option<Uuid>,
    /// 이 날짜부터 (포함).
    from: Option<NaiveDate>,
    /// 이 날짜까지 (포함).
    to: Option<NaiveDate>,
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
struct DayQuery {
    /// 해당 아기가 태그된 사진과 이야기, 그 아기의 마일스톤만.
    baby_id: Option<Uuid>,
}

#[utoipa::path(
    get,
    path = "/api/days",
    params(DaysQuery),
    responses(
        (status = 200, description = "사진 촬영일(휴지통 제외, 인스턴스 시간대), 이야기 날짜, 마일스톤 달성일 합집합의 최신순. `next_cursor` 는 마지막 날짜 `YYYY-MM-DD`", body = Page<DaySummary>),
        (status = 400, description = "쿼리 오류 (`request.invalidQuery`)", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
    )
)]
async fn list_days(
    State(state): State<AppState>,
    _current: CurrentUser,
    Query(q): Query<DaysQuery>,
) -> AppResult<Json<Page<DaySummary>>> {
    let limit = q.limit.unwrap_or(DEFAULT_LIMIT);
    if !(1..=MAX_LIMIT).contains(&limit) {
        return Err(AppError::bad_request("request.invalidQuery"));
    }
    let mut conn = state.pool.acquire().await?;
    let tz = settings::queries::load(&mut *conn).await?.timezone;
    let mut items = queries::list(
        &mut *conn,
        &tz,
        q.cursor,
        q.baby_id,
        q.from,
        q.to,
        limit + 1,
    )
    .await?;
    let next_cursor = if items.len() as i64 > limit {
        items.truncate(limit as usize);
        items.last().map(|last| last.date.to_string())
    } else {
        None
    };

    let dates: Vec<NaiveDate> = items.iter().map(|d| d.date).collect();
    let mut previews = queries::previews(&mut *conn, &tz, &dates, q.baby_id)
        .await?
        .into_iter()
        .peekable();
    // 두 결과 모두 날짜 내림차순.
    for day in &mut items {
        while let Some(p) = previews.next_if(|p| p.local_date == day.date) {
            day.preview.push(p);
        }
    }
    let (stories, milestones) = queries::records(&mut conn, &tz, &dates, q.baby_id).await?;
    // 날짜 집합에서 온 기록이라 해당 날 항상 존재.
    for s in stories {
        if let Some(day) = items.iter_mut().find(|d| d.date == s.entry_date) {
            day.stories.push(s);
        }
    }
    for m in milestones {
        if let Some(day) = items.iter_mut().find(|d| d.date == m.achieved_on) {
            day.milestones.push(m);
        }
    }
    Ok(Json(Page { items, next_cursor }))
}

#[utoipa::path(
    get,
    path = "/api/days/{date}",
    params(
        ("date" = NaiveDate, Path, description = "사진 촬영일(인스턴스 시간대), 이야기 날짜, 마일스톤 달성일"),
        DayQuery,
    ),
    responses(
        (status = 200, description = "그날 개수, 이야기, 마일스톤과 이전, 다음 날", body = DayDetail),
        (status = 400, description = "날짜·쿼리 형식 오류 (`request.invalidPath`, `request.invalidQuery`)", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 404, description = "그날 휴지통 밖 사진, 이야기, 마일스톤 모두 없음 (`day.notFound`)", body = ErrorBody),
    )
)]
async fn get_day(
    State(state): State<AppState>,
    _current: CurrentUser,
    Path(date): Path<NaiveDate>,
    Query(q): Query<DayQuery>,
) -> AppResult<Json<DayDetail>> {
    let mut conn = state.pool.acquire().await?;
    let tz = settings::queries::load(&mut *conn).await?.timezone;
    let mut day = queries::detail(&mut *conn, &tz, date, q.baby_id)
        .await?
        .ok_or(AppError::NotFound("day.notFound"))?;
    (day.stories, day.milestones) = queries::records(&mut conn, &tz, &[date], q.baby_id).await?;
    Ok(Json(day))
}
