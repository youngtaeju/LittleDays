use axum::{Json as AxumJson, extract::State, http::StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use utoipa::ToSchema;
use utoipa_axum::{router::OpenApiRouter, routes};

use super::password;
use crate::{
    error::{AppError, AppResult},
    request::Json,
    settings,
    state::AppState,
    users::{self, NewUser, Role, User},
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(signup))
        .routes(routes!(status))
}

#[derive(Deserialize, ToSchema)]
pub struct SignupRequest {
    username: String,
    password: String,
    display_name: String,
    instance_name: String,
}

#[derive(Serialize, ToSchema)]
pub struct SignupResponse {
    user: User,
}

#[derive(Serialize, ToSchema)]
pub struct StatusResponse {
    signup_open: bool,
}

fn bad_request(key: &'static str) -> AppError {
    AppError::BadRequest {
        key,
        params: json!({}),
    }
}

fn normalize_username(raw: &str) -> AppResult<String> {
    let username = raw.to_lowercase();
    let len = username.chars().count();
    let valid_chars = username
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
    if (3..=32).contains(&len) && valid_chars {
        Ok(username)
    } else {
        Err(bad_request("auth.usernameInvalid"))
    }
}

fn trimmed_name(raw: &str, key: &'static str) -> AppResult<String> {
    let name = raw.trim();
    if (1..=64).contains(&name.chars().count()) {
        Ok(name.to_string())
    } else {
        Err(bad_request(key))
    }
}

#[utoipa::path(
    post,
    path = "/api/auth/signup",
    request_body = SignupRequest,
    responses(
        (status = 201, description = "첫 사용자(owner) 생성", body = SignupResponse),
        (status = 400, description = "입력 검증 실패"),
        (status = 403, description = "가입 닫힘 (이미 사용자 존재)"),
        (status = 409, description = "사용자명 중복"),
    )
)]
async fn signup(
    State(state): State<AppState>,
    Json(req): Json<SignupRequest>,
) -> AppResult<(StatusCode, AxumJson<SignupResponse>)> {
    let username = normalize_username(&req.username)?;
    if req.password.chars().count() < 8 {
        return Err(bad_request("auth.passwordTooShort"));
    }
    let display_name = trimmed_name(&req.display_name, "auth.displayNameInvalid")?;
    let instance_name = trimmed_name(&req.instance_name, "settings.instanceNameInvalid")?;

    let password = req.password;
    let password_hash = tokio::task::spawn_blocking(move || password::hash(&password))
        .await
        .map_err(|e| AppError::Internal(e.into()))??;

    let mut tx = state.pool.begin().await?;
    sqlx::query!("LOCK TABLE users IN EXCLUSIVE MODE")
        .execute(&mut *tx)
        .await?;
    if users::queries::count(&mut *tx).await? > 0 {
        return Err(AppError::Forbidden("auth.signupClosed"));
    }
    let user = users::queries::create(
        &mut *tx,
        NewUser {
            username,
            password_hash,
            display_name,
            role: Role::Owner,
            email: None,
            locale: "ko".to_string(),
        },
    )
    .await?;
    settings::queries::set(&mut *tx, "instance_name", Value::String(instance_name)).await?;
    tx.commit().await?;

    Ok((StatusCode::CREATED, AxumJson(SignupResponse { user })))
}

#[utoipa::path(
    get,
    path = "/api/auth/status",
    responses((status = 200, description = "가입 가능 여부", body = StatusResponse))
)]
async fn status(State(state): State<AppState>) -> AppResult<AxumJson<StatusResponse>> {
    let signup_open = users::queries::count(&state.pool).await? == 0;
    Ok(AxumJson(StatusResponse { signup_open }))
}
