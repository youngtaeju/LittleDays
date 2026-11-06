use axum::{Json as AxumJson, extract::State};
use serde::Deserialize;
use serde_json::Value;
use utoipa::ToSchema;
use utoipa_axum::{router::OpenApiRouter, routes};

use super::{Settings, queries};
use crate::{
    auth::{
        extract::CurrentUser,
        validate::{trimmed_name, validate_locale},
    },
    error::{AppError, AppResult, ErrorBody},
    request::Json,
    state::AppState,
    users::Role,
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(get_settings, patch_settings))
}

/// 생략 필드는 유지.
#[derive(Deserialize, ToSchema)]
pub struct PatchSettingsRequest {
    /// 앞뒤 공백 제거 후 1~64자.
    instance_name: Option<String>,
    /// IANA 시간대 이름. 예: `Asia/Seoul`.
    timezone: Option<String>,
    /// `ko` 또는 `en`.
    default_locale: Option<String>,
    derivatives_avif: Option<bool>,
    /// 0~3650. 0 은 자동 비우기 끔.
    #[schema(maximum = 3650)]
    trash_retention_days: Option<u32>,
}

#[utoipa::path(
    get,
    path = "/api/settings",
    responses(
        (status = 200, description = "인스턴스 설정", body = Settings),
        (status = 401, description = "인증 필요", body = ErrorBody),
    )
)]
async fn get_settings(
    State(state): State<AppState>,
    _current: CurrentUser,
) -> AppResult<AxumJson<Settings>> {
    Ok(AxumJson(queries::load(&state.pool).await?))
}

#[utoipa::path(
    patch,
    path = "/api/settings",
    request_body = PatchSettingsRequest,
    responses(
        (status = 200, description = "갱신 후 전체 설정", body = Settings),
        (status = 400, description = "본문 형식 오류 또는 값 검증 실패", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 403, description = "owner 아님 또는 CSRF 헤더 누락", body = ErrorBody),
    )
)]
async fn patch_settings(
    State(state): State<AppState>,
    current: CurrentUser,
    Json(req): Json<PatchSettingsRequest>,
) -> AppResult<AxumJson<Settings>> {
    current.require(Role::Owner)?;

    // 전 필드 검증 후 기록. 일부 실패 시 미반영.
    let mut updates: Vec<(&str, Value)> = Vec::new();
    if let Some(raw) = &req.instance_name {
        let name = trimmed_name(raw, "settings.instanceNameInvalid")?;
        updates.push(("instance_name", Value::String(name)));
    }
    if let Some(tz) = req.timezone {
        if !queries::timezone_exists(&state.pool, &tz).await? {
            return Err(AppError::bad_request("settings.invalidTimezone"));
        }
        updates.push(("timezone", Value::String(tz)));
    }
    if let Some(raw) = &req.default_locale {
        let locale = validate_locale(raw, "settings.invalidLocale")?;
        updates.push(("default_locale", Value::String(locale)));
    }
    if let Some(avif) = req.derivatives_avif {
        updates.push(("derivatives_avif", Value::Bool(avif)));
    }
    if let Some(days) = req.trash_retention_days {
        if days > 3650 {
            return Err(AppError::bad_request("settings.trashRetentionInvalid"));
        }
        updates.push(("trash_retention_days", Value::from(days)));
    }

    let mut tx = state.pool.begin().await?;
    for (key, value) in updates {
        queries::set(&mut *tx, key, value).await?;
    }
    let settings = queries::load(&mut *tx).await?;
    tx.commit().await?;
    Ok(AxumJson(settings))
}
