use axum::{
    Json as AxumJson,
    extract::State,
    http::{HeaderMap, StatusCode},
};
use axum_extra::extract::CookieJar;
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use utoipa::ToSchema;
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use super::{Invite, NewInvite, queries};
use crate::{
    auth::{
        extract::CurrentUser,
        password,
        routes::UserResponse,
        session,
        validate::{validate_credentials, validate_display_name},
    },
    error::{AppError, AppResult, ErrorBody},
    request::{Json, Path},
    settings,
    state::AppState,
    users::{self, NewUser, Role},
};

const DEFAULT_EXPIRY_HOURS: u32 = 72;
const MAX_EXPIRY_HOURS: u32 = 720;

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(create_invite, list_invites))
        .routes(routes!(revoke_invite))
        .routes(routes!(preview_invite))
        .routes(routes!(accept_invite))
}

#[derive(Deserialize, ToSchema)]
pub struct CreateInviteRequest {
    /// `guardian` 또는 `family`.
    role: Role,
    /// 기본 72, 1~720.
    expires_in_hours: Option<u32>,
}

#[derive(Serialize, ToSchema)]
pub struct CreateInviteResponse {
    invite: Invite,
    /// `{PUBLIC_URL}/invite/{원문 토큰}`. 원문 토큰은 이 응답에서만 노출.
    url: String,
}

#[derive(Serialize, ToSchema)]
pub struct InvitesResponse {
    invites: Vec<Invite>,
}

#[derive(Serialize, ToSchema)]
pub struct InvitePreview {
    role: Role,
    instance_name: String,
    expires_at: DateTime<Utc>,
}

#[derive(Deserialize, ToSchema)]
pub struct AcceptInviteRequest {
    username: String,
    password: String,
    display_name: String,
}

/// 원문 토큰 조회 후 사용 가능 여부 확인.
async fn find_active(pool: &PgPool, raw: &str) -> AppResult<Invite> {
    let invite = queries::find_by_raw(pool, raw)
        .await?
        .ok_or(AppError::NotFound("invite.notFound"))?;
    invite.ensure_active()?;
    Ok(invite)
}

#[utoipa::path(
    post,
    path = "/api/invites",
    request_body = CreateInviteRequest,
    responses(
        (status = 201, description = "초대 발급", body = CreateInviteResponse),
        (status = 400, description = "본문 형식 오류, owner 역할 지정, 만료 시간 범위 밖", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 403, description = "owner 아님 또는 CSRF 헤더 누락", body = ErrorBody),
    )
)]
async fn create_invite(
    State(state): State<AppState>,
    current: CurrentUser,
    Json(req): Json<CreateInviteRequest>,
) -> AppResult<(StatusCode, AxumJson<CreateInviteResponse>)> {
    current.require(Role::Owner)?;
    if req.role == Role::Owner {
        return Err(AppError::bad_request("invite.roleNotAllowed"));
    }
    let hours = req.expires_in_hours.unwrap_or(DEFAULT_EXPIRY_HOURS);
    if !(1..=MAX_EXPIRY_HOURS).contains(&hours) {
        return Err(AppError::bad_request("invite.invalidExpiry"));
    }

    let (raw, invite) = queries::create(
        &state.pool,
        NewInvite {
            role: req.role,
            created_by: current.user.id,
            expires_in: Duration::hours(hours.into()),
        },
    )
    .await?;
    let url = format!("{}/invite/{raw}", state.config.public_url);
    Ok((
        StatusCode::CREATED,
        AxumJson(CreateInviteResponse { invite, url }),
    ))
}

#[utoipa::path(
    get,
    path = "/api/invites",
    responses(
        (status = 200, description = "초대 목록 (최신순)", body = InvitesResponse),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 403, description = "owner 아님", body = ErrorBody),
    )
)]
async fn list_invites(
    State(state): State<AppState>,
    current: CurrentUser,
) -> AppResult<AxumJson<InvitesResponse>> {
    current.require(Role::Owner)?;
    let invites = queries::list(&state.pool).await?;
    Ok(AxumJson(InvitesResponse { invites }))
}

#[utoipa::path(
    delete,
    path = "/api/invites/{id}",
    params(("id" = Uuid, Path, description = "초대 ID")),
    responses(
        (status = 204, description = "초대 회수 (이미 회수된 초대도 204)"),
        (status = 400, description = "잘못된 초대 ID 형식", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 403, description = "owner 아님 또는 CSRF 헤더 누락", body = ErrorBody),
        (status = 404, description = "초대 없음", body = ErrorBody),
        (status = 409, description = "이미 사용된 초대", body = ErrorBody),
    )
)]
async fn revoke_invite(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    current.require(Role::Owner)?;
    queries::revoke(&state.pool, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    path = "/api/invites/{raw}/preview",
    params(("raw" = String, Path, description = "초대 원문 토큰")),
    responses(
        (status = 200, description = "수락 화면용 초대 정보", body = InvitePreview),
        (status = 404, description = "초대 없음", body = ErrorBody),
        (status = 410, description = "만료, 사용됨, 회수됨", body = ErrorBody),
    )
)]
async fn preview_invite(
    State(state): State<AppState>,
    Path(raw): Path<String>,
) -> AppResult<AxumJson<InvitePreview>> {
    let invite = find_active(&state.pool, &raw).await?;
    let settings = settings::queries::load(&state.pool).await?;
    Ok(AxumJson(InvitePreview {
        role: invite.role,
        instance_name: settings.instance_name,
        expires_at: invite.expires_at,
    }))
}

#[utoipa::path(
    post,
    path = "/api/invites/{raw}/accept",
    params(("raw" = String, Path, description = "초대 원문 토큰")),
    request_body = AcceptInviteRequest,
    responses(
        (status = 201, description = "초대 역할로 사용자 생성, 세션 쿠키 발급", body = UserResponse),
        (status = 400, description = "입력 검증 실패", body = ErrorBody),
        (status = 404, description = "초대 없음", body = ErrorBody),
        (status = 409, description = "사용자명 중복 (초대는 유지)", body = ErrorBody),
        (status = 410, description = "만료, 사용됨, 회수됨", body = ErrorBody),
    )
)]
async fn accept_invite(
    State(state): State<AppState>,
    headers: HeaderMap,
    jar: CookieJar,
    Path(raw): Path<String>,
    Json(req): Json<AcceptInviteRequest>,
) -> AppResult<(StatusCode, CookieJar, AxumJson<UserResponse>)> {
    let username = validate_credentials(&req.username, &req.password)?;
    let display_name = validate_display_name(&req.display_name)?;

    // 무효 초대의 해시 비용 회피. 확정 검사는 트랜잭션 내 행 잠금 후.
    let invite = find_active(&state.pool, &raw).await?;
    let password_hash = password::hash_async(req.password).await?;
    let default_locale = settings::queries::load(&state.pool).await?.default_locale;

    let mut tx = state.pool.begin().await?;
    let invite = queries::find_for_update(&mut *tx, invite.id)
        .await?
        .ok_or(AppError::NotFound("invite.notFound"))?;
    invite.ensure_active()?;
    // 사용자명 중복 시 롤백. 초대는 미사용 유지.
    let user = users::queries::create(
        &mut *tx,
        NewUser {
            username,
            password_hash,
            display_name,
            role: invite.role,
            email: None,
            locale: default_locale,
        },
    )
    .await?;
    queries::mark_used(&mut *tx, invite.id, user.id).await?;
    let (session_raw, _) =
        session::create(&mut *tx, user.id, session::user_agent(&headers)).await?;
    tx.commit().await?;

    Ok((
        StatusCode::CREATED,
        jar.add(session::cookie(&state.config, session_raw)),
        AxumJson(UserResponse { user }),
    ))
}
