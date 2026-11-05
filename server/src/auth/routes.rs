use axum::{
    Json as AxumJson,
    extract::State,
    http::{HeaderMap, StatusCode, header},
};
use axum_extra::extract::CookieJar;
use chrono::{DateTime, Duration, SubsecRound, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use utoipa::ToSchema;
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use super::{
    extract::{self, CurrentUser},
    password,
    session::{self, SessionInfo},
    token,
};
use crate::{
    error::{AppError, AppResult},
    request::{Json, Path},
    settings,
    state::AppState,
    users::{self, NewUser, Role, User},
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(signup))
        .routes(routes!(status))
        .routes(routes!(login))
        .routes(routes!(logout))
        .routes(routes!(me))
        .routes(routes!(list_sessions))
        .routes(routes!(revoke_session))
        .routes(routes!(media_token))
}

#[derive(Deserialize, ToSchema)]
pub struct SignupRequest {
    username: String,
    password: String,
    display_name: String,
    instance_name: String,
}

#[derive(Deserialize, ToSchema)]
pub struct LoginRequest {
    username: String,
    password: String,
}

#[derive(Serialize, ToSchema)]
pub struct UserResponse {
    pub user: User,
}

#[derive(Serialize, ToSchema)]
pub struct SessionsResponse {
    sessions: Vec<SessionInfo>,
}

#[derive(Serialize, ToSchema)]
pub struct MediaTokenResponse {
    token: String,
    expires_at: DateTime<Utc>,
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

fn user_agent(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
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
        (status = 201, description = "첫 사용자(owner) 생성, 세션 쿠키 발급", body = UserResponse),
        (status = 400, description = "입력 검증 실패"),
        (status = 403, description = "가입 닫힘 (이미 사용자 존재)"),
        (status = 409, description = "사용자명 중복"),
    )
)]
async fn signup(
    State(state): State<AppState>,
    headers: HeaderMap,
    jar: CookieJar,
    Json(req): Json<SignupRequest>,
) -> AppResult<(StatusCode, CookieJar, AxumJson<UserResponse>)> {
    let username = normalize_username(&req.username)?;
    if req.password.chars().count() < 8 {
        return Err(bad_request("auth.passwordTooShort"));
    }
    let display_name = trimmed_name(&req.display_name, "auth.displayNameInvalid")?;
    let instance_name = trimmed_name(&req.instance_name, "settings.instanceNameInvalid")?;

    // 가입 닫힘 시 해시 비용 회피. 경합 대비 확정 검사는 트랜잭션 내부.
    if users::queries::count(&state.pool).await? > 0 {
        return Err(AppError::Forbidden("auth.signupClosed"));
    }
    let password_hash = password::hash_async(req.password).await?;

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
    let (raw, _) = session::create(&mut *tx, user.id, user_agent(&headers)).await?;
    tx.commit().await?;

    Ok((
        StatusCode::CREATED,
        jar.add(session::cookie(&state.config, raw)),
        AxumJson(UserResponse { user }),
    ))
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

#[utoipa::path(
    post,
    path = "/api/auth/login",
    request_body = LoginRequest,
    responses(
        (status = 200, description = "로그인, 세션 쿠키 발급", body = UserResponse),
        (status = 400, description = "본문 형식 오류"),
        (status = 401, description = "자격 증명 불일치 또는 비활성 사용자"),
    )
)]
async fn login(
    State(state): State<AppState>,
    headers: HeaderMap,
    jar: CookieJar,
    Json(req): Json<LoginRequest>,
) -> AppResult<(CookieJar, AxumJson<UserResponse>)> {
    let record = users::queries::find_by_username(&state.pool, &req.username).await?;
    let password_ok = match &record {
        Some(r) => password::verify_async(req.password, r.password_hash.clone()).await?,
        None => {
            password::verify_dummy_async(req.password).await?;
            false
        }
    };

    let Some(record) = record.filter(|_| password_ok) else {
        return Err(AppError::Unauthorized("auth.invalidCredentials"));
    };
    // 비밀번호 일치 시에만 비활성 여부 응답. 틀린 시도에는 계정 상태 비공개.
    if record.user.disabled_at.is_some() {
        return Err(AppError::Unauthorized("auth.disabled"));
    }

    let (raw, _) = session::create(&state.pool, record.user.id, user_agent(&headers)).await?;
    Ok((
        jar.add(session::cookie(&state.config, raw)),
        AxumJson(UserResponse { user: record.user }),
    ))
}

#[utoipa::path(
    post,
    path = "/api/auth/logout",
    responses(
        (status = 204, description = "유효 세션이면 삭제. 세션 유무와 무관하게 쿠키 제거"),
        (status = 403, description = "CSRF 헤더 누락"),
    )
)]
async fn logout(
    State(state): State<AppState>,
    headers: HeaderMap,
    jar: CookieJar,
) -> AppResult<(StatusCode, CookieJar)> {
    // 만료·무효·비활성 사용자 세션도 쿠키 제거 위해 `CurrentUser` 미사용.
    if let Some((raw, _)) = extract::credentials(&headers)
        && let Some(found) = session::find_by_raw(&state.pool, &raw).await?
    {
        session::delete(&state.pool, found.session_id).await?;
    }
    Ok((
        StatusCode::NO_CONTENT,
        jar.add(session::clear_cookie(&state.config)),
    ))
}

#[utoipa::path(
    get,
    path = "/api/auth/me",
    responses(
        (status = 200, description = "현재 사용자", body = UserResponse),
        (status = 401, description = "인증 필요 또는 비활성 사용자"),
    )
)]
async fn me(current: CurrentUser) -> AxumJson<UserResponse> {
    AxumJson(UserResponse { user: current.user })
}

#[utoipa::path(
    get,
    path = "/api/auth/sessions",
    responses(
        (status = 200, description = "본인 세션 목록", body = SessionsResponse),
        (status = 401, description = "인증 필요"),
    )
)]
async fn list_sessions(
    State(state): State<AppState>,
    current: CurrentUser,
) -> AppResult<AxumJson<SessionsResponse>> {
    let sessions = session::list_for_user(&state.pool, current.user.id, current.session_id).await?;
    Ok(AxumJson(SessionsResponse { sessions }))
}

#[utoipa::path(
    delete,
    path = "/api/auth/sessions/{id}",
    params(("id" = Uuid, Path, description = "세션 ID")),
    responses(
        (status = 204, description = "세션 삭제"),
        (status = 400, description = "잘못된 세션 ID 형식"),
        (status = 401, description = "인증 필요"),
        (status = 403, description = "CSRF 헤더 누락"),
        (status = 404, description = "본인 세션 아님 또는 없음"),
    )
)]
async fn revoke_session(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    if session::delete_for_user(&state.pool, current.user.id, id).await? {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(AppError::NotFound("auth.sessionNotFound"))
    }
}

#[utoipa::path(
    post,
    path = "/api/auth/media-token",
    responses(
        (status = 200, description = "미디어 URL 서명 토큰 (1시간)", body = MediaTokenResponse),
        (status = 401, description = "인증 필요"),
        (status = 403, description = "CSRF 헤더 누락"),
    )
)]
async fn media_token(
    State(state): State<AppState>,
    current: CurrentUser,
) -> AxumJson<MediaTokenResponse> {
    // 토큰 만료 정밀도(초)와 응답 시각 일치.
    let expires_at = (Utc::now() + Duration::hours(1)).trunc_subsecs(0);
    let token = token::sign_media(&state.config.secret_key, current.user.id, expires_at);
    AxumJson(MediaTokenResponse { token, expires_at })
}
