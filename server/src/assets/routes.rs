use axum::{Json, extract::State, http::StatusCode};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use utoipa::{IntoParams, ToSchema};
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use super::{Asset, AssetSummary, MonthCount, Page, cursor, queries};
use crate::{
    auth::extract::CurrentUser,
    babies,
    error::{AppError, AppResult, ErrorBody},
    jobs::{self, Job},
    request::{Json as ReqJson, Path, Query},
    settings,
    state::AppState,
    users::Role,
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(list_assets))
        .routes(routes!(list_months))
        .routes(routes!(get_asset, patch_asset))
        .routes(routes!(put_asset_babies))
        .routes(routes!(retry_asset))
}

const DEFAULT_LIMIT: i64 = 100;
const MAX_LIMIT: i64 = 500;
const MAX_CAPTION_CHARS: usize = 2000;

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
struct ListQuery {
    /// 이전 응답의 `next_cursor`.
    cursor: Option<String>,
    /// 1~500, 기본 100.
    limit: Option<i64>,
    /// 해당 아기가 태그된 자산만.
    baby_id: Option<Uuid>,
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
struct MonthsQuery {
    /// 해당 아기가 태그된 자산만.
    baby_id: Option<Uuid>,
}

/// 키가 있으면 `null` 포함 `Some`.
fn present<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<Option<String>>, D::Error> {
    Option::<String>::deserialize(d).map(Some)
}

#[derive(Deserialize, ToSchema)]
struct PatchAsset {
    /// 생략 시 변경 없음. `null` 또는 공백만 있는 문자열은 비움. 앞뒤 공백 제거, 최대 2000자.
    #[serde(default, deserialize_with = "present")]
    #[schema(value_type = Option<String>)]
    caption: Option<Option<String>>,
    /// 지정 시 출처 `manual`.
    taken_at: Option<DateTime<Utc>>,
}

#[derive(Deserialize, ToSchema)]
struct BabyIds {
    /// 태그 전체 교체 목록.
    baby_ids: Vec<Uuid>,
}

#[utoipa::path(
    get,
    path = "/api/assets",
    params(ListQuery),
    responses(
        (status = 200, description = "휴지통 제외, 촬영 시각 최신순", body = Page<AssetSummary>),
        (status = 400, description = "쿼리 오류 (`request.invalidQuery`, `asset.invalidCursor`)", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
    )
)]
async fn list_assets(
    State(state): State<AppState>,
    _current: CurrentUser,
    Query(q): Query<ListQuery>,
) -> AppResult<Json<Page<AssetSummary>>> {
    let limit = q.limit.unwrap_or(DEFAULT_LIMIT);
    if !(1..=MAX_LIMIT).contains(&limit) {
        return Err(AppError::bad_request("request.invalidQuery"));
    }
    let after = q.cursor.as_deref().map(cursor::decode).transpose()?;
    let tz = settings::queries::load(&state.pool).await?.timezone;
    let mut items = queries::list(&state.pool, &tz, after, q.baby_id, limit + 1).await?;
    let next_cursor = if items.len() as i64 > limit {
        items.truncate(limit as usize);
        items
            .last()
            .map(|last| cursor::encode(last.taken_at, last.id))
    } else {
        None
    };
    Ok(Json(Page { items, next_cursor }))
}

#[utoipa::path(
    get,
    path = "/api/assets/months",
    params(MonthsQuery),
    responses(
        (status = 200, description = "인스턴스 시간대 기준 월별 개수, 최신 월부터", body = Vec<MonthCount>),
        (status = 400, description = "쿼리 오류 (`request.invalidQuery`)", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
    )
)]
async fn list_months(
    State(state): State<AppState>,
    _current: CurrentUser,
    Query(q): Query<MonthsQuery>,
) -> AppResult<Json<Vec<MonthCount>>> {
    let tz = settings::queries::load(&state.pool).await?.timezone;
    Ok(Json(queries::months(&state.pool, &tz, q.baby_id).await?))
}

#[utoipa::path(
    get,
    path = "/api/assets/{id}",
    params(("id" = Uuid, Path, description = "자산 ID")),
    responses(
        (status = 200, description = "자산 상세", body = Asset),
        (status = 400, description = "ID 형식 오류", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 404, description = "자산 없음, 또는 family 에게 휴지통 자산 (`asset.notFound`)", body = ErrorBody),
    )
)]
async fn get_asset(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Asset>> {
    let asset = queries::get(&state.pool, id)
        .await?
        .filter(|a| a.deleted_at.is_none() || current.require(Role::Guardian).is_ok())
        .ok_or(AppError::NotFound("asset.notFound"))?;
    Ok(Json(asset))
}

#[utoipa::path(
    patch,
    path = "/api/assets/{id}",
    params(("id" = Uuid, Path, description = "자산 ID")),
    request_body = PatchAsset,
    responses(
        (status = 200, description = "갱신된 자산", body = Asset),
        (status = 400, description = "형식 오류 (`asset.captionTooLong`)", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 403, description = "guardian 이상 아님 또는 CSRF 헤더 누락", body = ErrorBody),
        (status = 404, description = "자산 없음 (`asset.notFound`)", body = ErrorBody),
    )
)]
async fn patch_asset(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(id): Path<Uuid>,
    ReqJson(body): ReqJson<PatchAsset>,
) -> AppResult<Json<Asset>> {
    current.require(Role::Guardian)?;
    let caption = body
        .caption
        .as_ref()
        .map(|c| c.as_deref().map_or("", str::trim));
    if caption.is_some_and(|c| c.chars().count() > MAX_CAPTION_CHARS) {
        return Err(AppError::bad_request("asset.captionTooLong"));
    }
    let caption = caption.map(|c| Some(c).filter(|c| !c.is_empty()));
    let mut tx = state.pool.begin().await?;
    if !queries::update_meta(&mut *tx, id, caption, body.taken_at).await? {
        return Err(AppError::NotFound("asset.notFound"));
    }
    let asset = queries::get(&mut *tx, id)
        .await?
        .ok_or(AppError::NotFound("asset.notFound"))?;
    tx.commit().await?;
    Ok(Json(asset))
}

#[utoipa::path(
    put,
    path = "/api/assets/{id}/babies",
    params(("id" = Uuid, Path, description = "자산 ID")),
    request_body = BabyIds,
    responses(
        (status = 200, description = "태그 교체 후 자산", body = Asset),
        (status = 400, description = "존재하지 않는 아기 (`asset.babyInvalid`)", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 403, description = "guardian 이상 아님 또는 CSRF 헤더 누락", body = ErrorBody),
        (status = 404, description = "자산 없음 (`asset.notFound`)", body = ErrorBody),
    )
)]
async fn put_asset_babies(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(id): Path<Uuid>,
    ReqJson(body): ReqJson<BabyIds>,
) -> AppResult<Json<Asset>> {
    current.require(Role::Guardian)?;
    let mut tx = state.pool.begin().await?;
    let known = babies::queries::all_ids(&mut *tx).await?;
    if body.baby_ids.iter().any(|b| !known.contains(b)) {
        return Err(AppError::bad_request("asset.babyInvalid"));
    }
    if queries::get(&mut *tx, id).await?.is_none() {
        return Err(AppError::NotFound("asset.notFound"));
    }
    queries::remove_babies_except(&mut *tx, id, &body.baby_ids).await?;
    queries::add_babies(&mut *tx, id, &body.baby_ids, current.user.id).await?;
    let asset = queries::get(&mut *tx, id)
        .await?
        .ok_or(AppError::NotFound("asset.notFound"))?;
    tx.commit().await?;
    Ok(Json(asset))
}

#[utoipa::path(
    post,
    path = "/api/assets/{id}/retry",
    params(("id" = Uuid, Path, description = "자산 ID")),
    responses(
        (status = 202, description = "재처리 등록 (`processing`, `processing_error` 비움)", body = Asset),
        (status = 400, description = "ID 형식 오류", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 403, description = "guardian 이상 아님 또는 CSRF 헤더 누락", body = ErrorBody),
        (status = 404, description = "자산 없음 (`asset.notFound`)", body = ErrorBody),
        (status = 409, description = "`failed` 상태 아님 (`asset.notFailed`)", body = ErrorBody),
    )
)]
async fn retry_asset(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(id): Path<Uuid>,
) -> AppResult<(StatusCode, Json<Asset>)> {
    current.require(Role::Guardian)?;
    let mut tx = state.pool.begin().await?;
    if !queries::mark_retry(&mut *tx, id).await? {
        return Err(match queries::get(&mut *tx, id).await? {
            Some(_) => AppError::conflict("asset.notFailed"),
            None => AppError::NotFound("asset.notFound"),
        });
    }
    // failed 자산의 작업은 failed 행뿐(워커가 자산과 함께 기록). 이전 행 대체.
    jobs::delete_for_asset(&mut *tx, id).await?;
    jobs::enqueue(&mut *tx, &Job::ProcessAsset { asset_id: id }).await?;
    let asset = queries::get(&mut *tx, id)
        .await?
        .ok_or(AppError::NotFound("asset.notFound"))?;
    tx.commit().await?;
    state.jobs_wake.notify_one();
    Ok((StatusCode::ACCEPTED, Json(asset)))
}
