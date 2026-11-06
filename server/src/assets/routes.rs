use axum::{Json, extract::State, http::StatusCode};
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use super::{Asset, queries};
use crate::{
    auth::extract::CurrentUser,
    error::{AppError, AppResult, ErrorBody},
    jobs::{self, Job},
    request::Path,
    state::AppState,
    users::Role,
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(retry_asset))
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
