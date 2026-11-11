use axum::{Json, extract::State, http::StatusCode};
use serde::Deserialize;
use utoipa::IntoParams;
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use super::{Like, queries, require_visible};
use crate::{
    assets::{AssetSummary, Page, cursor},
    auth::extract::CurrentUser,
    error::{AppError, AppResult, ErrorBody},
    request::{Path, Query},
    settings,
    state::AppState,
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(put_like, delete_like))
        .routes(routes!(list_likes))
        .routes(routes!(put_favorite, delete_favorite))
        .routes(routes!(list_favorites))
}

const DEFAULT_LIMIT: i64 = 100;
const MAX_LIMIT: i64 = 500;

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
struct FavoritesQuery {
    /// 이전 응답의 `next_cursor`.
    cursor: Option<String>,
    /// 1~500, 기본 100.
    limit: Option<i64>,
}

#[utoipa::path(
    put,
    path = "/api/assets/{id}/like",
    params(("id" = Uuid, Path, description = "자산 ID")),
    responses(
        (status = 204, description = "하트 켬. 이미 켠 상태면 그대로"),
        (status = 400, description = "ID 형식 오류", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 403, description = "CSRF 헤더 누락", body = ErrorBody),
        (status = 404, description = "자산 없음 또는 휴지통 (`asset.notFound`)", body = ErrorBody),
    )
)]
async fn put_like(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let mut tx = state.pool.begin().await?;
    require_visible(&mut *tx, id).await?;
    queries::like(&mut *tx, id, current.user.id).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    delete,
    path = "/api/assets/{id}/like",
    params(("id" = Uuid, Path, description = "자산 ID")),
    responses(
        (status = 204, description = "하트 끔. 이미 끈 상태면 그대로"),
        (status = 400, description = "ID 형식 오류", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 403, description = "CSRF 헤더 누락", body = ErrorBody),
        (status = 404, description = "자산 없음 또는 휴지통 (`asset.notFound`)", body = ErrorBody),
    )
)]
async fn delete_like(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    require_visible(&state.pool, id).await?;
    queries::unlike(&state.pool, id, current.user.id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    path = "/api/assets/{id}/likes",
    params(("id" = Uuid, Path, description = "자산 ID")),
    responses(
        (status = 200, description = "하트 누른 사람. 최신순", body = Vec<Like>),
        (status = 400, description = "ID 형식 오류", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 404, description = "자산 없음 또는 휴지통 (`asset.notFound`)", body = ErrorBody),
    )
)]
async fn list_likes(
    State(state): State<AppState>,
    _current: CurrentUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Vec<Like>>> {
    require_visible(&state.pool, id).await?;
    Ok(Json(queries::likes(&state.pool, id).await?))
}

#[utoipa::path(
    put,
    path = "/api/assets/{id}/favorite",
    params(("id" = Uuid, Path, description = "자산 ID")),
    responses(
        (status = 204, description = "즐겨찾기 켬. 이미 켠 상태면 그대로"),
        (status = 400, description = "ID 형식 오류", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 403, description = "CSRF 헤더 누락", body = ErrorBody),
        (status = 404, description = "자산 없음 또는 휴지통 (`asset.notFound`)", body = ErrorBody),
    )
)]
async fn put_favorite(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let mut tx = state.pool.begin().await?;
    require_visible(&mut *tx, id).await?;
    queries::favorite(&mut *tx, id, current.user.id).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    delete,
    path = "/api/assets/{id}/favorite",
    params(("id" = Uuid, Path, description = "자산 ID")),
    responses(
        (status = 204, description = "즐겨찾기 끔. 이미 끈 상태면 그대로"),
        (status = 400, description = "ID 형식 오류", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 403, description = "CSRF 헤더 누락", body = ErrorBody),
        (status = 404, description = "자산 없음 또는 휴지통 (`asset.notFound`)", body = ErrorBody),
    )
)]
async fn delete_favorite(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    require_visible(&state.pool, id).await?;
    queries::unfavorite(&state.pool, id, current.user.id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    path = "/api/favorites",
    params(FavoritesQuery),
    responses(
        (status = 200, description = "내 즐겨찾기. 휴지통 제외, 즐겨찾기 시각 최신순", body = Page<AssetSummary>),
        (status = 400, description = "쿼리 오류 (`request.invalidQuery`, `asset.invalidCursor`)", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
    )
)]
async fn list_favorites(
    State(state): State<AppState>,
    current: CurrentUser,
    Query(q): Query<FavoritesQuery>,
) -> AppResult<Json<Page<AssetSummary>>> {
    let limit = q.limit.unwrap_or(DEFAULT_LIMIT);
    if !(1..=MAX_LIMIT).contains(&limit) {
        return Err(AppError::bad_request("request.invalidQuery"));
    }
    let after = q.cursor.as_deref().map(cursor::decode).transpose()?;
    let tz = settings::queries::load(&state.pool).await?.timezone;
    let mut rows = queries::favorites(&state.pool, &tz, current.user.id, after, limit + 1).await?;
    let next_cursor = if rows.len() as i64 > limit {
        rows.truncate(limit as usize);
        rows.last()
            .map(|(favorited_at, asset)| cursor::encode(*favorited_at, asset.id))
    } else {
        None
    };
    let items = rows.into_iter().map(|(_, asset)| asset).collect();
    Ok(Json(Page { items, next_cursor }))
}
