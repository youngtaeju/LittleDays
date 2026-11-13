use axum::{Json, extract::State, http::StatusCode};
use serde::Deserialize;
use utoipa::{IntoParams, ToSchema};
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use super::{AlbumSummary, check_assets, check_count, normalize_name, queries, require_write};
use crate::{
    assets::{AssetSummary, Page, cursor},
    auth::extract::CurrentUser,
    error::{AppError, AppResult, ErrorBody},
    request::{Json as JsonBody, Path, Query},
    settings,
    state::AppState,
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(list_albums, create_album))
        .routes(routes!(get_album, update_album, delete_album))
        .routes(routes!(list_album_assets))
        .routes(routes!(add_album_assets))
        .routes(routes!(remove_album_assets))
}

#[derive(Deserialize, ToSchema)]
struct CreateAlbumRequest {
    /// 앞뒤 공백 제거 후 1~50자. 중복 허용.
    name: String,
    /// 함께 넣을 사진. 넣기와 같은 검증(1~500개, 휴지통 아닌 사진, 중복은 한 번만).
    asset_ids: Option<Vec<Uuid>>,
}

/// 보낸 필드만 교체.
#[derive(Deserialize, ToSchema)]
struct UpdateAlbumRequest {
    /// 앞뒤 공백 제거 후 1~50자.
    name: Option<String>,
    /// 생략 시 변경 없음. 앨범 안의 휴지통 아닌 처리 완료 사진. `null` 이면 기본 표지.
    #[serde(default, deserialize_with = "crate::records::present")]
    #[schema(value_type = Option<Uuid>)]
    cover_asset_id: Option<Option<Uuid>>,
}

const DEFAULT_LIMIT: i64 = 100;
const MAX_LIMIT: i64 = 500;

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
struct AlbumAssetsQuery {
    /// 이전 응답의 `next_cursor`.
    cursor: Option<String>,
    /// 1~500, 기본 100.
    limit: Option<i64>,
}

#[derive(Deserialize, ToSchema)]
struct AlbumAssetsRequest {
    /// 1~500개. 중복은 한 번만.
    asset_ids: Vec<Uuid>,
}

#[utoipa::path(
    get,
    path = "/api/albums",
    responses(
        (status = 200, description = "전체 앨범. 휴지통 아닌 사진의 마지막 넣은 시각(비면 만든 시각) 최신순", body = Vec<AlbumSummary>),
        (status = 401, description = "인증 필요", body = ErrorBody),
    )
)]
async fn list_albums(
    State(state): State<AppState>,
    _current: CurrentUser,
) -> AppResult<Json<Vec<AlbumSummary>>> {
    let mut conn = state.pool.acquire().await?;
    let timezone = settings::queries::load(&mut *conn).await?.timezone;
    Ok(Json(queries::summaries(&mut conn, &timezone, None).await?))
}

#[utoipa::path(
    post,
    path = "/api/albums",
    request_body = CreateAlbumRequest,
    responses(
        (status = 201, description = "만들어짐", body = AlbumSummary),
        (status = 400, description = "이름 오류 (`album.nameInvalid`), 사진 개수 오류 (`request.invalidBody`)", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 403, description = "guardian 이상 아님 (`album.forbidden`) 또는 CSRF 헤더 누락", body = ErrorBody),
        (status = 404, description = "사진 없음 또는 휴지통 (`asset.notFound`)", body = ErrorBody),
    )
)]
async fn create_album(
    State(state): State<AppState>,
    current: CurrentUser,
    JsonBody(req): JsonBody<CreateAlbumRequest>,
) -> AppResult<(StatusCode, Json<AlbumSummary>)> {
    require_write(&current)?;
    let name = normalize_name(&req.name)?;
    let mut tx = state.pool.begin().await?;
    let asset_ids = match &req.asset_ids {
        Some(ids) => check_assets(&mut tx, ids).await?,
        None => Vec::new(),
    };
    let id = Uuid::now_v7();
    queries::insert(&mut *tx, id, name, current.user.id).await?;
    if !asset_ids.is_empty() {
        queries::add_assets(&mut tx, id, current.user.id, &asset_ids).await?;
    }
    let timezone = settings::queries::load(&mut *tx).await?.timezone;
    let album = queries::summaries(&mut tx, &timezone, Some(&[id]))
        .await?
        .pop()
        .ok_or(AppError::NotFound("album.notFound"))?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(album)))
}

#[utoipa::path(
    get,
    path = "/api/albums/{id}",
    params(("id" = Uuid, Path, description = "앨범 ID")),
    responses(
        (status = 200, description = "앨범", body = AlbumSummary),
        (status = 400, description = "ID 형식 오류", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 404, description = "앨범 없음 (`album.notFound`)", body = ErrorBody),
    )
)]
async fn get_album(
    State(state): State<AppState>,
    _current: CurrentUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<AlbumSummary>> {
    let mut conn = state.pool.acquire().await?;
    let timezone = settings::queries::load(&mut *conn).await?.timezone;
    queries::summaries(&mut conn, &timezone, Some(&[id]))
        .await?
        .pop()
        .map(Json)
        .ok_or(AppError::NotFound("album.notFound"))
}

#[utoipa::path(
    get,
    path = "/api/albums/{id}/assets",
    params(("id" = Uuid, Path, description = "앨범 ID"), AlbumAssetsQuery),
    responses(
        (status = 200, description = "휴지통 제외, 촬영 시각 오래된 순", body = Page<AssetSummary>),
        (status = 400, description = "쿼리 오류 (`request.invalidQuery`, `asset.invalidCursor`)", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 404, description = "앨범 없음 (`album.notFound`)", body = ErrorBody),
    )
)]
async fn list_album_assets(
    State(state): State<AppState>,
    _current: CurrentUser,
    Path(id): Path<Uuid>,
    Query(q): Query<AlbumAssetsQuery>,
) -> AppResult<Json<Page<AssetSummary>>> {
    let limit = q.limit.unwrap_or(DEFAULT_LIMIT);
    if !(1..=MAX_LIMIT).contains(&limit) {
        return Err(AppError::bad_request("request.invalidQuery"));
    }
    let after = q.cursor.as_deref().map(cursor::decode).transpose()?;
    let mut conn = state.pool.acquire().await?;
    if !queries::exists(&mut *conn, id).await? {
        return Err(AppError::NotFound("album.notFound"));
    }
    let tz = settings::queries::load(&mut *conn).await?.timezone;
    let mut items = queries::list_assets(&mut *conn, &tz, id, after, limit + 1).await?;
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
    patch,
    path = "/api/albums/{id}",
    params(("id" = Uuid, Path, description = "앨범 ID")),
    request_body = UpdateAlbumRequest,
    responses(
        (status = 200, description = "고쳐짐", body = AlbumSummary),
        (status = 400, description = "이름 오류 (`album.nameInvalid`), 표지 오류 (`album.coverInvalid`)", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 403, description = "guardian 이상 아님 (`album.forbidden`) 또는 CSRF 헤더 누락", body = ErrorBody),
        (status = 404, description = "앨범 없음 (`album.notFound`)", body = ErrorBody),
    )
)]
async fn update_album(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(id): Path<Uuid>,
    JsonBody(req): JsonBody<UpdateAlbumRequest>,
) -> AppResult<Json<AlbumSummary>> {
    require_write(&current)?;
    let name = req.name.as_deref().map(normalize_name).transpose()?;
    let mut tx = state.pool.begin().await?;
    if !queries::lock_for_link(&mut *tx, id).await? {
        return Err(AppError::NotFound("album.notFound"));
    }
    if let Some(Some(cover)) = req.cover_asset_id
        && !queries::lock_cover_candidate(&mut *tx, id, cover).await?
    {
        return Err(AppError::bad_request("album.coverInvalid"));
    }
    queries::update(&mut *tx, id, name, req.cover_asset_id).await?;
    let timezone = settings::queries::load(&mut *tx).await?.timezone;
    let album = queries::summaries(&mut tx, &timezone, Some(&[id]))
        .await?
        .pop()
        .ok_or(AppError::NotFound("album.notFound"))?;
    tx.commit().await?;
    Ok(Json(album))
}

#[utoipa::path(
    delete,
    path = "/api/albums/{id}",
    params(("id" = Uuid, Path, description = "앨범 ID")),
    responses(
        (status = 204, description = "지워짐. 사진은 남음"),
        (status = 400, description = "ID 형식 오류", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 403, description = "guardian 이상 아님 (`album.forbidden`) 또는 CSRF 헤더 누락", body = ErrorBody),
        (status = 404, description = "앨범 없음 (`album.notFound`)", body = ErrorBody),
    )
)]
async fn delete_album(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    require_write(&current)?;
    if !queries::delete(&state.pool, id).await? {
        return Err(AppError::NotFound("album.notFound"));
    }
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    post,
    path = "/api/albums/{id}/assets",
    params(("id" = Uuid, Path, description = "앨범 ID")),
    request_body = AlbumAssetsRequest,
    responses(
        (status = 204, description = "넣음. 이미 든 사진은 그대로"),
        (status = 400, description = "사진 개수 오류 (`request.invalidBody`)", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 403, description = "guardian 이상 아님 (`album.forbidden`) 또는 CSRF 헤더 누락", body = ErrorBody),
        (status = 404, description = "앨범 없음 (`album.notFound`), 사진 없음 또는 휴지통 (`asset.notFound`). 하나라도 있으면 아무것도 넣지 않음", body = ErrorBody),
    )
)]
async fn add_album_assets(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(id): Path<Uuid>,
    JsonBody(req): JsonBody<AlbumAssetsRequest>,
) -> AppResult<StatusCode> {
    require_write(&current)?;
    let mut tx = state.pool.begin().await?;
    if !queries::lock_for_link(&mut *tx, id).await? {
        return Err(AppError::NotFound("album.notFound"));
    }
    let asset_ids = check_assets(&mut tx, &req.asset_ids).await?;
    queries::add_assets(&mut tx, id, current.user.id, &asset_ids).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    post,
    path = "/api/albums/{id}/assets/remove",
    params(("id" = Uuid, Path, description = "앨범 ID")),
    request_body = AlbumAssetsRequest,
    responses(
        (status = 204, description = "뺌. 없는 연결은 무시. 뺀 사진이 지정 표지면 기본 표지로"),
        (status = 400, description = "사진 개수 오류 (`request.invalidBody`)", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 403, description = "guardian 이상 아님 (`album.forbidden`) 또는 CSRF 헤더 누락", body = ErrorBody),
        (status = 404, description = "앨범 없음 (`album.notFound`)", body = ErrorBody),
    )
)]
async fn remove_album_assets(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(id): Path<Uuid>,
    JsonBody(req): JsonBody<AlbumAssetsRequest>,
) -> AppResult<StatusCode> {
    require_write(&current)?;
    check_count(&req.asset_ids)?;
    let mut tx = state.pool.begin().await?;
    if !queries::lock_for_link(&mut *tx, id).await? {
        return Err(AppError::NotFound("album.notFound"));
    }
    queries::remove_assets(&mut tx, id, &req.asset_ids).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}
