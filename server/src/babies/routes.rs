use axum::{Json as AxumJson, extract::State, http::StatusCode};
use chrono::NaiveDate;
use serde::Deserialize;
use utoipa::ToSchema;
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use super::{AvatarCrop, Baby, BabyInput, BabyStats, Sex, queries};
use crate::{
    auth::{extract::CurrentUser, validate::trimmed_name},
    error::{AppError, AppResult, ErrorBody},
    request::{Json, Path},
    settings,
    state::AppState,
    users::Role,
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(list_babies, create_baby))
        .routes(routes!(replace_baby, delete_baby))
        .routes(routes!(reorder_babies))
        .routes(routes!(baby_stats))
}

#[derive(Deserialize, ToSchema)]
pub struct CreateBabyRequest {
    /// 앞뒤 공백 제거 후 1~64자.
    name: String,
    birth_date: NaiveDate,
    sex: Option<Sex>,
}

/// 전체 교체. 생략한 `sex`, `avatar_asset_id` 는 `null` 로 교체.
#[derive(Deserialize, ToSchema)]
pub struct ReplaceBabyRequest {
    /// 앞뒤 공백 제거 후 1~64자.
    name: String,
    birth_date: NaiveDate,
    #[schema(required = true)]
    sex: Option<Sex>,
    /// `ready` 상태의 휴지통 밖 사진만 허용.
    #[schema(required = true)]
    avatar_asset_id: Option<Uuid>,
    /// 대표 사진 자르기. 생략 시 `null`. 대표 사진이 있을 때만 허용.
    avatar_crop: Option<AvatarCrop>,
}

#[derive(Deserialize, ToSchema)]
pub struct ReorderBabiesRequest {
    /// 전체 아기 ID 를 원하는 순서로. 누락·중복·모르는 ID 는 거부.
    ids: Vec<Uuid>,
}

#[utoipa::path(
    get,
    path = "/api/babies",
    responses(
        (status = 200, description = "아기 목록 (표시 순서)", body = Vec<Baby>),
        (status = 401, description = "인증 필요", body = ErrorBody),
    )
)]
async fn list_babies(
    State(state): State<AppState>,
    _current: CurrentUser,
) -> AppResult<AxumJson<Vec<Baby>>> {
    Ok(AxumJson(queries::list(&state.pool).await?))
}

#[utoipa::path(
    post,
    path = "/api/babies",
    request_body = CreateBabyRequest,
    responses(
        (status = 201, description = "아기 생성 (목록 맨 끝)", body = Baby),
        (status = 400, description = "본문 형식 또는 이름 오류", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 403, description = "guardian 이상 아님 또는 CSRF 헤더 누락", body = ErrorBody),
    )
)]
async fn create_baby(
    State(state): State<AppState>,
    current: CurrentUser,
    Json(req): Json<CreateBabyRequest>,
) -> AppResult<(StatusCode, AxumJson<Baby>)> {
    current.require(Role::Guardian)?;
    let input = BabyInput {
        name: trimmed_name(&req.name, "babies.nameInvalid")?,
        birth_date: req.birth_date,
        sex: req.sex,
    };
    let baby = queries::create(&state.pool, input).await?;
    Ok((StatusCode::CREATED, AxumJson(baby)))
}

#[utoipa::path(
    put,
    path = "/api/babies/{id}",
    params(("id" = Uuid, Path, description = "아기 ID")),
    request_body = ReplaceBabyRequest,
    responses(
        (status = 200, description = "교체된 아기", body = Baby),
        (status = 400, description = "본문 형식, 이름, 대표 사진, 자르기 영역 오류", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 403, description = "guardian 이상 아님 또는 CSRF 헤더 누락", body = ErrorBody),
        (status = 404, description = "아기 없음", body = ErrorBody),
    )
)]
async fn replace_baby(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(id): Path<Uuid>,
    Json(req): Json<ReplaceBabyRequest>,
) -> AppResult<AxumJson<Baby>> {
    current.require(Role::Guardian)?;
    let input = BabyInput {
        name: trimmed_name(&req.name, "babies.nameInvalid")?,
        birth_date: req.birth_date,
        sex: req.sex,
    };
    match req.avatar_asset_id {
        Some(asset_id) => {
            let dims = queries::valid_avatar_dims(&state.pool, asset_id)
                .await?
                .ok_or(AppError::bad_request("babies.avatarInvalid"))?;
            if let Some(crop) = &req.avatar_crop
                && !dims.is_some_and(|(w, h)| crop.fits(w, h))
            {
                return Err(AppError::bad_request("babies.avatarCropInvalid"));
            }
        }
        None if req.avatar_crop.is_some() => {
            return Err(AppError::bad_request("babies.avatarCropInvalid"));
        }
        None => {}
    }
    let baby =
        queries::replace(&state.pool, id, input, req.avatar_asset_id, req.avatar_crop).await?;
    Ok(AxumJson(baby))
}

#[utoipa::path(
    delete,
    path = "/api/babies/{id}",
    params(("id" = Uuid, Path, description = "아기 ID")),
    responses(
        (status = 204, description = "삭제 (자산 태그는 함께 삭제)"),
        (status = 400, description = "잘못된 ID 형식", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 403, description = "guardian 이상 아님 또는 CSRF 헤더 누락", body = ErrorBody),
        (status = 404, description = "아기 없음", body = ErrorBody),
    )
)]
async fn delete_baby(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    current.require(Role::Guardian)?;
    let mut tx = state.pool.begin().await?;
    queries::delete(&mut tx, id).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    put,
    path = "/api/babies/order",
    request_body = ReorderBabiesRequest,
    responses(
        (status = 204, description = "표시 순서 변경"),
        (status = 400, description = "본문 형식 오류 또는 ID 집합 불일치", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 403, description = "guardian 이상 아님 또는 CSRF 헤더 누락", body = ErrorBody),
    )
)]
async fn reorder_babies(
    State(state): State<AppState>,
    current: CurrentUser,
    Json(req): Json<ReorderBabiesRequest>,
) -> AppResult<StatusCode> {
    current.require(Role::Guardian)?;
    let mut tx = state.pool.begin().await?;
    queries::reorder(&mut tx, &req.ids).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    path = "/api/babies/{id}/stats",
    params(("id" = Uuid, Path, description = "아기 ID")),
    responses(
        (status = 200, description = "사진·영상·기록한 날 수와 생후 개월별 묶음", body = BabyStats),
        (status = 400, description = "잘못된 ID 형식", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 404, description = "아기 없음 (`babies.notFound`)", body = ErrorBody),
    )
)]
async fn baby_stats(
    State(state): State<AppState>,
    _current: CurrentUser,
    Path(id): Path<Uuid>,
) -> AppResult<AxumJson<BabyStats>> {
    let tz = settings::queries::load(&state.pool).await?.timezone;
    Ok(AxumJson(queries::stats(&state.pool, id, &tz).await?))
}
