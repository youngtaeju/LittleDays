use axum::{Json, extract::State, http::StatusCode};
use chrono::NaiveDate;
use serde::Deserialize;
use sqlx::PgConnection;
use utoipa::ToSchema;
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use super::{Milestone, MilestoneSummary, check_label_pair, queries, queries::Values};
use crate::{
    auth::extract::CurrentUser,
    error::{AppError, AppResult, ErrorBody},
    links::{self, LinkKind},
    records::{self, baby_birth_date, present},
    request::{Json as JsonBody, Path},
    settings,
    state::AppState,
    users::Role,
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(list_milestones, create_milestone))
        .routes(routes!(get_milestone, update_milestone, delete_milestone))
}

#[derive(Deserialize, ToSchema)]
struct CreateMilestoneRequest {
    /// 미리 정한 항목 키. `custom_label` 과 정확히 하나. 아기당 한 번.
    preset_key: Option<String>,
    /// 직접 입력, 앞뒤 공백 제거 후 1~30자.
    custom_label: Option<String>,
    /// 아기 생일 이후(포함), 인스턴스 시간대 오늘 이전(포함).
    achieved_on: NaiveDate,
    /// 앞뒤 공백 제거 후 100자 이하. 빈 값은 없음.
    note: Option<String>,
    /// 붙일 순서. 휴지통 아닌 사진만, 중복은 한 번만, 200장 이하.
    asset_ids: Vec<Uuid>,
}

/// 보낸 필드만 교체. 결과에 `preset_key` 와 `custom_label` 중 정확히 하나가 남아야 함.
#[derive(Deserialize, ToSchema)]
struct UpdateMilestoneRequest {
    #[serde(default, deserialize_with = "present")]
    #[schema(value_type = Option<String>)]
    preset_key: Option<Option<String>>,
    #[serde(default, deserialize_with = "present")]
    #[schema(value_type = Option<String>)]
    custom_label: Option<Option<String>>,
    achieved_on: Option<NaiveDate>,
    #[serde(default, deserialize_with = "present")]
    #[schema(value_type = Option<String>)]
    note: Option<Option<String>>,
    /// 전체 교체, 목록 순서가 붙일 순서.
    asset_ids: Option<Vec<Uuid>>,
}

/// 생일 이전이거나 오늘 이후면 400 `milestone.dateInvalid`.
async fn check_date(
    conn: &mut PgConnection,
    timezone: &str,
    birth: NaiveDate,
    date: NaiveDate,
) -> AppResult<()> {
    if date < birth || !records::not_future(&mut *conn, timezone, date).await? {
        return Err(AppError::bad_request("milestone.dateInvalid"));
    }
    Ok(())
}

fn normalize_note(raw: &str) -> AppResult<Option<&str>> {
    records::normalize_note_or(raw, "milestone.noteInvalid")
}

#[utoipa::path(
    get,
    path = "/api/babies/{id}/milestones",
    params(("id" = Uuid, Path, description = "아기 ID")),
    responses(
        (status = 200, description = "달성일 오래된 순, 같은 날은 만든 순", body = Vec<MilestoneSummary>),
        (status = 400, description = "ID 형식 오류", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 404, description = "아기 없음 (`babies.notFound`)", body = ErrorBody),
    )
)]
async fn list_milestones(
    State(state): State<AppState>,
    _current: CurrentUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Vec<MilestoneSummary>>> {
    let mut tx = state.pool.begin().await?;
    baby_birth_date(&mut *tx, id)
        .await?
        .ok_or(AppError::NotFound("babies.notFound"))?;
    let timezone = settings::queries::load(&mut *tx).await?.timezone;
    let rows = queries::list_for_baby(&mut tx, &timezone, id).await?;
    Ok(Json(rows))
}

#[utoipa::path(
    post,
    path = "/api/babies/{id}/milestones",
    params(("id" = Uuid, Path, description = "아기 ID")),
    request_body = CreateMilestoneRequest,
    responses(
        (status = 201, description = "기록됨", body = Milestone),
        (status = 400, description = "항목, 날짜, 메모 오류 (`milestone.presetInvalid`, `milestone.labelInvalid`, `milestone.dateInvalid`, `milestone.noteInvalid`, 사진 200장 초과 `request.invalidBody`)", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 403, description = "guardian 이상 아님 (`auth.forbidden`) 또는 CSRF 헤더 누락", body = ErrorBody),
        (status = 404, description = "아기 없음 (`babies.notFound`) 또는 사진 없음, 휴지통 (`asset.notFound`)", body = ErrorBody),
        (status = 409, description = "같은 아기에 같은 미리 정한 항목 (`milestone.duplicate`)", body = ErrorBody),
    )
)]
async fn create_milestone(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(baby_id): Path<Uuid>,
    JsonBody(req): JsonBody<CreateMilestoneRequest>,
) -> AppResult<(StatusCode, Json<Milestone>)> {
    current.require(Role::Guardian)?;
    let mut tx = state.pool.begin().await?;
    let birth = baby_birth_date(&mut *tx, baby_id)
        .await?
        .ok_or(AppError::NotFound("babies.notFound"))?;
    let (preset_key, custom_label) =
        check_label_pair(req.preset_key.as_deref(), req.custom_label.as_deref())?;
    let note = req
        .note
        .as_deref()
        .map(normalize_note)
        .transpose()?
        .flatten();
    let timezone = settings::queries::load(&mut *tx).await?.timezone;
    check_date(&mut tx, &timezone, birth, req.achieved_on).await?;
    let asset_ids = links::check_assets(&mut tx, &req.asset_ids).await?;

    let id = Uuid::now_v7();
    queries::insert(
        &mut *tx,
        id,
        baby_id,
        Values {
            preset_key,
            custom_label,
            achieved_on: req.achieved_on,
            note,
        },
        current.user.id,
    )
    .await?;
    links::replace_assets(&mut tx, LinkKind::Milestone, id, &asset_ids).await?;
    let milestone = queries::get(&mut tx, &timezone, id)
        .await?
        .ok_or(AppError::NotFound("milestone.notFound"))?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(milestone)))
}

#[utoipa::path(
    get,
    path = "/api/milestones/{id}",
    params(("id" = Uuid, Path, description = "마일스톤 ID")),
    responses(
        (status = 200, description = "마일스톤 상세", body = Milestone),
        (status = 400, description = "ID 형식 오류", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 404, description = "마일스톤 없음 (`milestone.notFound`)", body = ErrorBody),
    )
)]
async fn get_milestone(
    State(state): State<AppState>,
    _current: CurrentUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Milestone>> {
    let mut tx = state.pool.begin().await?;
    let timezone = settings::queries::load(&mut *tx).await?.timezone;
    let milestone = queries::get(&mut tx, &timezone, id)
        .await?
        .ok_or(AppError::NotFound("milestone.notFound"))?;
    Ok(Json(milestone))
}

#[utoipa::path(
    patch,
    path = "/api/milestones/{id}",
    params(("id" = Uuid, Path, description = "마일스톤 ID")),
    request_body = UpdateMilestoneRequest,
    responses(
        (status = 200, description = "고쳐짐", body = Milestone),
        (status = 400, description = "항목, 날짜, 메모 오류 (`milestone.presetInvalid`, `milestone.labelInvalid`, `milestone.dateInvalid`, `milestone.noteInvalid`, 사진 200장 초과 `request.invalidBody`)", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 403, description = "guardian 이상 아님 (`auth.forbidden`) 또는 CSRF 헤더 누락", body = ErrorBody),
        (status = 404, description = "마일스톤 없음 (`milestone.notFound`) 또는 사진 없음, 휴지통 (`asset.notFound`)", body = ErrorBody),
        (status = 409, description = "같은 아기에 같은 미리 정한 항목 (`milestone.duplicate`)", body = ErrorBody),
    )
)]
async fn update_milestone(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(id): Path<Uuid>,
    JsonBody(req): JsonBody<UpdateMilestoneRequest>,
) -> AppResult<Json<Milestone>> {
    current.require(Role::Guardian)?;
    let mut tx = state.pool.begin().await?;
    let old = queries::lock(&mut *tx, id)
        .await?
        .ok_or(AppError::NotFound("milestone.notFound"))?;
    let preset = match &req.preset_key {
        Some(v) => v.as_deref(),
        None => old.preset_key.as_deref(),
    };
    let custom = match &req.custom_label {
        Some(v) => v.as_deref(),
        None => old.custom_label.as_deref(),
    };
    let (preset_key, custom_label) = check_label_pair(preset, custom)?;
    let note = match &req.note {
        Some(Some(raw)) => normalize_note(raw)?,
        Some(None) => None,
        None => old.note.as_deref(),
    };
    let timezone = settings::queries::load(&mut *tx).await?.timezone;
    let achieved_on = req.achieved_on.unwrap_or(old.achieved_on);
    if req.achieved_on.is_some() {
        let birth = baby_birth_date(&mut *tx, old.baby_id)
            .await?
            .ok_or(AppError::NotFound("milestone.notFound"))?;
        check_date(&mut tx, &timezone, birth, achieved_on).await?;
    }
    let asset_ids = match &req.asset_ids {
        Some(ids) => Some(links::check_assets(&mut tx, ids).await?),
        None => None,
    };
    queries::update(
        &mut *tx,
        id,
        Values {
            preset_key,
            custom_label,
            achieved_on,
            note,
        },
    )
    .await?;
    if let Some(ids) = &asset_ids {
        links::replace_assets(&mut tx, LinkKind::Milestone, id, ids).await?;
    }
    let milestone = queries::get(&mut tx, &timezone, id)
        .await?
        .ok_or(AppError::NotFound("milestone.notFound"))?;
    tx.commit().await?;
    Ok(Json(milestone))
}

#[utoipa::path(
    delete,
    path = "/api/milestones/{id}",
    params(("id" = Uuid, Path, description = "마일스톤 ID")),
    responses(
        (status = 204, description = "지워짐"),
        (status = 400, description = "ID 형식 오류", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 403, description = "guardian 이상 아님 (`auth.forbidden`) 또는 CSRF 헤더 누락", body = ErrorBody),
        (status = 404, description = "마일스톤 없음 (`milestone.notFound`)", body = ErrorBody),
    )
)]
async fn delete_milestone(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    current.require(Role::Guardian)?;
    if !queries::delete(&state.pool, id).await? {
        return Err(AppError::NotFound("milestone.notFound"));
    }
    Ok(StatusCode::NO_CONTENT)
}
