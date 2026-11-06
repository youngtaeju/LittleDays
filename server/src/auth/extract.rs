use axum::{
    extract::{FromRequestParts, MatchedPath, Request},
    http::{HeaderMap, HeaderValue, Method, header, request::Parts},
    middleware::Next,
    response::{IntoResponse, Response},
};
use axum_extra::extract::CookieJar;
use uuid::Uuid;

use chrono::Utc;
use serde::Deserialize;
use sqlx::PgPool;
use utoipa::IntoParams;

use super::{session, token};
use crate::{
    error::{AppError, AppResult},
    state::AppState,
    users::{self, Role, User},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthVia {
    Cookie,
    Bearer,
}

#[derive(Debug, Clone)]
pub struct CurrentUser {
    pub user: User,
    pub session_id: Uuid,
    pub via: AuthVia,
}

fn rank(role: Role) -> u8 {
    match role {
        Role::Owner => 3,
        Role::Guardian => 2,
        Role::Family => 1,
    }
}

impl CurrentUser {
    /// 역할 하한 검사. owner > guardian > family.
    pub fn require(&self, min: Role) -> AppResult<()> {
        if rank(self.user.role) >= rank(min) {
            Ok(())
        } else {
            Err(AppError::Forbidden("auth.forbidden"))
        }
    }
}

/// `Authorization: Bearer <token>` 의 토큰. 스킴 대소문자 무시(RFC 7235).
/// 빈 토큰도 `Some("")`(무효 Bearer로 거부, 쿠키 폴백 없음). 비 UTF-8 이나 다른 스킴은 `None`.
fn bearer_token(headers: &HeaderMap) -> Option<&str> {
    let value = headers.get(header::AUTHORIZATION)?.to_str().ok()?.trim();
    let (scheme, token) = value.split_once(' ').unwrap_or((value, ""));
    scheme.eq_ignore_ascii_case("bearer").then(|| token.trim())
}

/// Bearer 존재 시 Bearer 전용(쿠키 폴백 없음). 그 외 `Authorization`(Basic 등) 무시, 세션 쿠키 사용.
pub(super) fn credentials(headers: &HeaderMap) -> Option<(String, AuthVia)> {
    if let Some(token) = bearer_token(headers) {
        return Some((token.to_string(), AuthVia::Bearer));
    }
    let jar = CookieJar::from_headers(headers);
    let raw = jar.get(session::COOKIE_NAME)?.value().to_string();
    Some((raw, AuthVia::Cookie))
}

/// 세션 자격 증명 검증. 정지 사용자는 세션 삭제 후 `auth.disabled`. 통과 시 `touch`.
async fn authenticate_session(pool: &PgPool, raw: &str) -> AppResult<(User, Uuid)> {
    let found = session::find_by_raw(pool, raw)
        .await?
        .ok_or(AppError::Unauthorized("auth.required"))?;
    if found.user.disabled_at.is_some() {
        session::delete(pool, found.session_id).await?;
        return Err(AppError::Unauthorized("auth.disabled"));
    }
    session::touch(pool, found.session_id).await?;
    Ok((found.user, found.session_id))
}

impl FromRequestParts<AppState> for CurrentUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> AppResult<Self> {
        let (raw, via) =
            credentials(&parts.headers).ok_or(AppError::Unauthorized("auth.required"))?;
        let (user, session_id) = authenticate_session(&state.pool, &raw).await?;
        Ok(CurrentUser {
            user,
            session_id,
            via,
        })
    }
}

/// 미디어 URL 인증용 쿼리. 문서 전용 겸 추출용.
#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct MediaQuery {
    /// `POST /api/auth/media-token` 토큰. 세션 자격 증명이 없을 때만 사용.
    pub t: Option<String>,
}

/// 미디어 바이트 요청 사용자. 세션 자격 증명(Bearer/쿠키)이 있으면 `CurrentUser` 와 같은 검증,
/// 없으면 쿼리 `t` 의 미디어 토큰. 토큰은 세션과 무관해 정지 여부를 매번 확인.
#[derive(Debug, Clone)]
pub struct MediaUser {
    pub user: User,
}

impl FromRequestParts<AppState> for MediaUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> AppResult<Self> {
        let required = || AppError::Unauthorized("auth.required");
        if let Some((raw, _)) = credentials(&parts.headers) {
            let (user, _) = authenticate_session(&state.pool, &raw).await?;
            return Ok(MediaUser { user });
        }
        let token = axum::extract::Query::<MediaQuery>::try_from_uri(&parts.uri)
            .ok()
            .and_then(|q| q.0.t)
            .ok_or_else(required)?;
        let user_id = token::verify_media(&state.config.secret_key, &token, Utc::now())
            .ok_or_else(required)?;
        let user = users::queries::find_by_id(&state.pool, user_id)
            .await?
            .ok_or_else(required)?;
        if user.disabled_at.is_some() {
            return Err(AppError::Unauthorized("auth.disabled"));
        }
        Ok(MediaUser { user })
    }
}

/// 세션 발급 전 단계라 CSRF 검사 제외. 라우트 템플릿 기준.
const CSRF_EXEMPT: &[&str] = &[
    "/api/auth/login",
    "/api/auth/signup",
    "/api/invites/{raw}/accept",
];
const CSRF_HEADER_VALUE: HeaderValue = HeaderValue::from_static("LittleDays");

/// 쿠키 인증의 상태 변경 요청에 `X-Requested-With: LittleDays` 요구.
/// Bearer 요청과 세션 쿠키 없는 요청은 대상 외. Basic 등 다른 `Authorization` 은 면제 사유 아님.
pub async fn csrf_layer(req: Request, next: Next) -> Response {
    let state_changing = matches!(
        *req.method(),
        Method::POST | Method::PUT | Method::PATCH | Method::DELETE
    );
    let exempt = req
        .extensions()
        .get::<MatchedPath>()
        .is_some_and(|p| CSRF_EXEMPT.contains(&p.as_str()));
    let headers = req.headers();
    if state_changing
        && !exempt
        && bearer_token(headers).is_none()
        && CookieJar::from_headers(headers)
            .get(session::COOKIE_NAME)
            .is_some()
        && headers.get("x-requested-with") != Some(&CSRF_HEADER_VALUE)
    {
        return AppError::Forbidden("auth.csrf").into_response();
    }
    next.run(req).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn current(role: Role) -> CurrentUser {
        CurrentUser {
            user: User {
                id: Uuid::now_v7(),
                username: "u".into(),
                display_name: "u".into(),
                role,
                email: None,
                locale: "ko".into(),
                created_at: Utc::now(),
                disabled_at: None,
            },
            session_id: Uuid::now_v7(),
            via: AuthVia::Cookie,
        }
    }

    fn auth_headers(value: &[u8]) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_bytes(value).unwrap(),
        );
        headers
    }

    #[test]
    fn bearer_token_parsing() {
        assert_eq!(bearer_token(&auth_headers(b"Bearer abc")), Some("abc"));
        assert_eq!(bearer_token(&auth_headers(b"bearer abc")), Some("abc"));
        assert_eq!(bearer_token(&auth_headers(b"BEARER  abc ")), Some("abc"));
        assert_eq!(bearer_token(&auth_headers(b"Bearer")), Some(""));
        assert_eq!(bearer_token(&auth_headers(b"Bearer ")), Some(""));
        assert_eq!(bearer_token(&auth_headers(b"Basic bW9tOnB3")), None);
        assert_eq!(bearer_token(&auth_headers(b"Bearerabc")), None);
        assert_eq!(bearer_token(&auth_headers(b"Bearer \xff")), None);
        assert_eq!(bearer_token(&HeaderMap::new()), None);
    }

    #[test]
    fn require_follows_role_order() {
        use Role::*;
        let allowed = [
            (Owner, Owner),
            (Owner, Guardian),
            (Owner, Family),
            (Guardian, Guardian),
            (Guardian, Family),
            (Family, Family),
        ];
        for actual in [Owner, Guardian, Family] {
            for min in [Owner, Guardian, Family] {
                let result = current(actual).require(min);
                if allowed.contains(&(actual, min)) {
                    assert!(result.is_ok(), "{actual:?} >= {min:?}");
                } else {
                    assert!(
                        matches!(result, Err(AppError::Forbidden("auth.forbidden"))),
                        "{actual:?} < {min:?}"
                    );
                }
            }
        }
    }
}
