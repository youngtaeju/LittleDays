use axum::{Json as AxumJson, extract::State, http::StatusCode};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use super::{ProfileUpdate, Role, User, queries};
use crate::{
    auth::{
        extract::CurrentUser,
        password,
        routes::UserResponse,
        session,
        validate::{validate_display_name, validate_locale, validate_password},
    },
    error::{AppError, AppResult, ErrorBody},
    request::{Json, Path},
    state::AppState,
};

/// RFC 5321 경로 길이 상한.
const EMAIL_MAX_CHARS: usize = 254;

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(list_users))
        .routes(routes!(patch_user))
        .routes(routes!(patch_me))
        .routes(routes!(change_password))
}

#[derive(Serialize, ToSchema)]
pub struct UsersResponse {
    users: Vec<User>,
}

/// 생략 필드는 유지.
#[derive(Deserialize, ToSchema)]
pub struct PatchUserRequest {
    /// `guardian` 또는 `family`.
    role: Option<Role>,
    /// `true` 면 비활성화와 전 세션 삭제, `false` 면 재활성화.
    disabled: Option<bool>,
}

/// 생략 필드는 유지.
#[derive(Deserialize, ToSchema)]
pub struct PatchMeRequest {
    /// 앞뒤 공백 제거 후 1~64자.
    display_name: Option<String>,
    /// `ko` 또는 `en`.
    locale: Option<String>,
    /// 빈 문자열이면 삭제.
    email: Option<String>,
}

#[derive(Deserialize, ToSchema)]
pub struct ChangePasswordRequest {
    current_password: String,
    /// 8자 이상.
    new_password: String,
}

/// 앞뒤 공백 제거. 빈 값 → `None`(삭제).
fn normalize_email(raw: &str) -> AppResult<Option<String>> {
    let email = raw.trim();
    if email.is_empty() {
        return Ok(None);
    }
    if !email.contains('@') || email.chars().count() > EMAIL_MAX_CHARS {
        return Err(AppError::bad_request("users.invalidEmail"));
    }
    Ok(Some(email.to_string()))
}

#[utoipa::path(
    get,
    path = "/api/users",
    responses(
        (status = 200, description = "사용자 목록 (가입 순)", body = UsersResponse),
        (status = 401, description = "인증 필요", body = ErrorBody),
    )
)]
async fn list_users(
    State(state): State<AppState>,
    _current: CurrentUser,
) -> AppResult<AxumJson<UsersResponse>> {
    let users = queries::list(&state.pool).await?;
    Ok(AxumJson(UsersResponse { users }))
}

#[utoipa::path(
    patch,
    path = "/api/users/{id}",
    params(("id" = Uuid, Path, description = "사용자 ID")),
    request_body = PatchUserRequest,
    responses(
        (status = 200, description = "갱신된 사용자", body = UserResponse),
        (status = 400, description = "본문·ID 형식 오류, 본인 대상, owner 역할 지정", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 403, description = "owner 아님 또는 CSRF 헤더 누락", body = ErrorBody),
        (status = 404, description = "사용자 없음", body = ErrorBody),
    )
)]
async fn patch_user(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(id): Path<Uuid>,
    Json(req): Json<PatchUserRequest>,
) -> AppResult<AxumJson<UserResponse>> {
    current.require(Role::Owner)?;
    if id == current.user.id {
        return Err(AppError::bad_request("users.cannotEditSelf"));
    }
    // 단일 owner 전제. 소유권 이전 미지원.
    if req.role == Some(Role::Owner) {
        return Err(AppError::bad_request("users.roleNotAllowed"));
    }

    let not_found = || AppError::NotFound("users.notFound");
    let mut tx = state.pool.begin().await?;
    if let Some(role) = req.role
        && !queries::update_role(&mut *tx, id, role).await?
    {
        return Err(not_found());
    }
    if let Some(disabled) = req.disabled {
        if !queries::set_disabled(&mut *tx, id, disabled).await? {
            return Err(not_found());
        }
        if disabled {
            session::delete_all_for_user(&mut *tx, id).await?;
        }
    }
    let user = queries::find_by_id(&mut *tx, id)
        .await?
        .ok_or_else(not_found)?;
    tx.commit().await?;
    Ok(AxumJson(UserResponse { user }))
}

#[utoipa::path(
    patch,
    path = "/api/users/me",
    request_body = PatchMeRequest,
    responses(
        (status = 200, description = "갱신된 본인 정보", body = UserResponse),
        (status = 400, description = "본문 형식 오류 또는 값 검증 실패", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 403, description = "CSRF 헤더 누락", body = ErrorBody),
    )
)]
async fn patch_me(
    State(state): State<AppState>,
    current: CurrentUser,
    Json(req): Json<PatchMeRequest>,
) -> AppResult<AxumJson<UserResponse>> {
    let update = ProfileUpdate {
        display_name: req
            .display_name
            .as_deref()
            .map(validate_display_name)
            .transpose()?,
        locale: req
            .locale
            .as_deref()
            .map(|l| validate_locale(l, "users.invalidLocale"))
            .transpose()?,
        email: req.email.as_deref().map(normalize_email).transpose()?,
    };
    let user = queries::update_profile(&state.pool, current.user.id, update)
        .await?
        .ok_or(AppError::Unauthorized("auth.required"))?;
    Ok(AxumJson(UserResponse { user }))
}

#[utoipa::path(
    post,
    path = "/api/users/me/password",
    request_body = ChangePasswordRequest,
    responses(
        (status = 204, description = "비밀번호 변경. 현재 세션 외 전부 삭제"),
        (status = 400, description = "본문 형식 오류 또는 새 비밀번호 검증 실패", body = ErrorBody),
        (status = 401, description = "인증 필요 또는 현재 비밀번호 불일치", body = ErrorBody),
        (status = 403, description = "CSRF 헤더 누락", body = ErrorBody),
    )
)]
async fn change_password(
    State(state): State<AppState>,
    current: CurrentUser,
    Json(req): Json<ChangePasswordRequest>,
) -> AppResult<StatusCode> {
    validate_password(&req.new_password)?;
    let user_id = current.user.id;
    let stored = queries::password_hash(&state.pool, user_id)
        .await?
        .ok_or(AppError::Unauthorized("auth.required"))?;
    if !password::verify_async(req.current_password, stored).await? {
        return Err(AppError::Unauthorized("auth.invalidCredentials"));
    }
    let new_hash = password::hash_async(req.new_password).await?;

    let mut tx = state.pool.begin().await?;
    queries::update_password(&mut *tx, user_id, &new_hash).await?;
    session::delete_all_except(&mut *tx, user_id, current.session_id).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}
