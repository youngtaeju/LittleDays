use axum::{Json, extract::State, http::StatusCode};
use chrono::NaiveDate;
use serde::Deserialize;
use sqlx::PgConnection;
use utoipa::ToSchema;
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use super::{
    GrowthRecord, check_height, check_weight, normalize_note, present, queries, queries::Values,
};
use crate::{
    auth::extract::CurrentUser,
    error::{AppError, AppResult, ErrorBody},
    request::{Json as JsonBody, Path},
    settings,
    state::AppState,
    users::Role,
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(list_growth, create_growth))
        .routes(routes!(update_growth, delete_growth))
}

#[derive(Deserialize, ToSchema)]
struct CreateGrowthRequest {
    /// 아기 생일 이후(포함), 인스턴스 시간대 오늘 이전(포함).
    measured_on: NaiveDate,
    /// 20.0~150.0 cm, 소수 1자리. 키와 몸무게 중 하나 이상 필수.
    height_cm: Option<f64>,
    /// 0.50~50.00 kg, 소수 2자리.
    weight_kg: Option<f64>,
    /// 앞뒤 공백 제거 후 100자 이하. 빈 값은 없음.
    note: Option<String>,
}

/// 보낸 필드만 교체. `null` 은 비움, 결과에 키나 몸무게 하나는 남아야 함.
#[derive(Deserialize, ToSchema)]
struct UpdateGrowthRequest {
    measured_on: Option<NaiveDate>,
    #[serde(default, deserialize_with = "present")]
    #[schema(value_type = Option<f64>)]
    height_cm: Option<Option<f64>>,
    #[serde(default, deserialize_with = "present")]
    #[schema(value_type = Option<f64>)]
    weight_kg: Option<Option<f64>>,
    #[serde(default, deserialize_with = "present")]
    #[schema(value_type = Option<String>)]
    note: Option<Option<String>>,
}

/// 생일 이전이거나 오늘 이후면 400 `growth.dateInvalid`.
async fn check_date(
    conn: &mut PgConnection,
    timezone: &str,
    birth: NaiveDate,
    date: NaiveDate,
) -> AppResult<()> {
    if date < birth || !queries::not_future(&mut *conn, timezone, date).await? {
        return Err(AppError::bad_request("growth.dateInvalid"));
    }
    Ok(())
}

/// 값 범위와 하나 이상 존재 확인.
fn check_values(height: Option<f64>, weight: Option<f64>) -> AppResult<()> {
    if height.is_none() && weight.is_none() {
        return Err(AppError::bad_request("growth.valueInvalid"));
    }
    height.map_or(Ok(()), check_height)?;
    weight.map_or(Ok(()), check_weight)
}

#[utoipa::path(
    get,
    path = "/api/babies/{id}/growth",
    params(("id" = Uuid, Path, description = "아기 ID")),
    responses(
        (status = 200, description = "측정일 오래된 순, 같은 날은 만든 순", body = Vec<GrowthRecord>),
        (status = 400, description = "ID 형식 오류", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 404, description = "아기 없음 (`babies.notFound`)", body = ErrorBody),
    )
)]
async fn list_growth(
    State(state): State<AppState>,
    _current: CurrentUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Vec<GrowthRecord>>> {
    queries::baby_birth_date(&state.pool, id)
        .await?
        .ok_or(AppError::NotFound("babies.notFound"))?;
    Ok(Json(queries::list(&state.pool, id).await?))
}

#[utoipa::path(
    post,
    path = "/api/babies/{id}/growth",
    params(("id" = Uuid, Path, description = "아기 ID")),
    request_body = CreateGrowthRequest,
    responses(
        (status = 201, description = "기록됨", body = GrowthRecord),
        (status = 400, description = "값, 날짜, 메모 오류 (`growth.valueInvalid`, `growth.dateInvalid`, `growth.noteInvalid`)", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 403, description = "guardian 이상 아님 (`auth.forbidden`) 또는 CSRF 헤더 누락", body = ErrorBody),
        (status = 404, description = "아기 없음 (`babies.notFound`)", body = ErrorBody),
    )
)]
async fn create_growth(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(baby_id): Path<Uuid>,
    JsonBody(req): JsonBody<CreateGrowthRequest>,
) -> AppResult<(StatusCode, Json<GrowthRecord>)> {
    current.require(Role::Guardian)?;
    let mut tx = state.pool.begin().await?;
    let birth = queries::baby_birth_date(&mut *tx, baby_id)
        .await?
        .ok_or(AppError::NotFound("babies.notFound"))?;
    check_values(req.height_cm, req.weight_kg)?;
    let note = req
        .note
        .as_deref()
        .map(normalize_note)
        .transpose()?
        .flatten();
    let timezone = settings::queries::load(&mut *tx).await?.timezone;
    check_date(&mut tx, &timezone, birth, req.measured_on).await?;
    let record = queries::insert(
        &mut *tx,
        Uuid::now_v7(),
        baby_id,
        Values {
            measured_on: req.measured_on,
            height_cm: req.height_cm,
            weight_kg: req.weight_kg,
            note,
        },
        current.user.id,
    )
    .await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(record)))
}

#[utoipa::path(
    patch,
    path = "/api/growth/{id}",
    params(("id" = Uuid, Path, description = "성장 기록 ID")),
    request_body = UpdateGrowthRequest,
    responses(
        (status = 200, description = "고쳐짐", body = GrowthRecord),
        (status = 400, description = "값, 날짜, 메모 오류 (`growth.valueInvalid`, `growth.dateInvalid`, `growth.noteInvalid`)", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 403, description = "guardian 이상 아님 (`auth.forbidden`) 또는 CSRF 헤더 누락", body = ErrorBody),
        (status = 404, description = "기록 없음 (`growth.notFound`)", body = ErrorBody),
    )
)]
async fn update_growth(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(id): Path<Uuid>,
    JsonBody(req): JsonBody<UpdateGrowthRequest>,
) -> AppResult<Json<GrowthRecord>> {
    current.require(Role::Guardian)?;
    let mut tx = state.pool.begin().await?;
    let old = queries::lock(&mut *tx, id)
        .await?
        .ok_or(AppError::NotFound("growth.notFound"))?;
    let height = req.height_cm.unwrap_or(old.height_cm);
    let weight = req.weight_kg.unwrap_or(old.weight_kg);
    check_values(height, weight)?;
    let note = match &req.note {
        Some(Some(raw)) => normalize_note(raw)?,
        Some(None) => None,
        None => old.note.as_deref(),
    };
    let measured_on = req.measured_on.unwrap_or(old.measured_on);
    if req.measured_on.is_some() {
        let birth = queries::baby_birth_date(&mut *tx, old.baby_id)
            .await?
            .ok_or(AppError::NotFound("growth.notFound"))?;
        let timezone = settings::queries::load(&mut *tx).await?.timezone;
        check_date(&mut tx, &timezone, birth, measured_on).await?;
    }
    let record = queries::update(
        &mut *tx,
        id,
        Values {
            measured_on,
            height_cm: height,
            weight_kg: weight,
            note,
        },
    )
    .await?;
    tx.commit().await?;
    Ok(Json(record))
}

#[utoipa::path(
    delete,
    path = "/api/growth/{id}",
    params(("id" = Uuid, Path, description = "성장 기록 ID")),
    responses(
        (status = 204, description = "지워짐"),
        (status = 400, description = "ID 형식 오류", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 403, description = "guardian 이상 아님 (`auth.forbidden`) 또는 CSRF 헤더 누락", body = ErrorBody),
        (status = 404, description = "기록 없음 (`growth.notFound`)", body = ErrorBody),
    )
)]
async fn delete_growth(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    current.require(Role::Guardian)?;
    if !queries::delete(&state.pool, id).await? {
        return Err(AppError::NotFound("growth.notFound"));
    }
    Ok(StatusCode::NO_CONTENT)
}
