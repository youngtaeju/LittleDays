use axum::http::{HeaderMap, header};
use axum_extra::extract::cookie::{Cookie, SameSite};
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::PgExecutor;
use utoipa::ToSchema;
use uuid::Uuid;

use super::token;
use crate::{
    config::Config,
    error::AppResult,
    users::{Role, User},
};

pub const COOKIE_NAME: &str = "ld_session";
/// 쿠키 Max-Age. SQL 의 `interval '30 days'` 와 동일 값.
const TTL_SECS: u64 = 30 * 24 * 3600;
const USER_AGENT_MAX_CHARS: usize = 512;

pub struct SessionWithUser {
    pub session_id: Uuid,
    pub user: User,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SessionInfo {
    pub id: Uuid,
    #[schema(required = true)]
    pub user_agent: Option<String>,
    pub created_at: DateTime<Utc>,
    pub last_seen_at: DateTime<Utc>,
    /// 요청에 사용된 세션 여부.
    pub current: bool,
}

/// 세션 생성 시 기록용. 비 ASCII 등 해석 불가 값은 `None`.
pub fn user_agent(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
}

/// 원문 토큰과 세션 ID 반환. DB 에는 SHA-256 해시만 저장.
pub async fn create(
    exec: impl PgExecutor<'_>,
    user_id: Uuid,
    user_agent: Option<&str>,
) -> AppResult<(String, Uuid)> {
    let (raw, token_hash) = token::generate();
    let id = Uuid::now_v7();
    let user_agent: Option<String> =
        user_agent.map(|ua| ua.chars().take(USER_AGENT_MAX_CHARS).collect());
    sqlx::query!(
        "INSERT INTO sessions (id, user_id, token_hash, user_agent, expires_at)
         VALUES ($1, $2, $3, $4, now() + interval '30 days')",
        id,
        user_id,
        token_hash,
        user_agent,
    )
    .execute(exec)
    .await?;
    Ok((raw, id))
}

/// 만료 세션 제외.
pub async fn find_by_raw(
    exec: impl PgExecutor<'_>,
    raw: &str,
) -> AppResult<Option<SessionWithUser>> {
    let row = sqlx::query!(
        r#"SELECT s.id AS session_id, u.id, u.username, u.display_name, u.role AS "role: Role",
                  u.email, u.locale, u.created_at, u.disabled_at
           FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = $1 AND s.expires_at > now()"#,
        token::hash(raw),
    )
    .fetch_optional(exec)
    .await?;
    Ok(row.map(|r| SessionWithUser {
        session_id: r.session_id,
        user: User {
            id: r.id,
            username: r.username,
            display_name: r.display_name,
            role: r.role,
            email: r.email,
            locale: r.locale,
            created_at: r.created_at,
            disabled_at: r.disabled_at,
        },
    }))
}

/// 슬라이딩 만료. 쓰기 부하 억제 위해 1시간에 1회만 갱신.
pub async fn touch(exec: impl PgExecutor<'_>, session_id: Uuid) -> AppResult<()> {
    sqlx::query!(
        "UPDATE sessions SET last_seen_at = now(), expires_at = now() + interval '30 days'
         WHERE id = $1 AND last_seen_at < now() - interval '1 hour'",
        session_id,
    )
    .execute(exec)
    .await?;
    Ok(())
}

pub async fn delete(exec: impl PgExecutor<'_>, session_id: Uuid) -> AppResult<()> {
    sqlx::query!("DELETE FROM sessions WHERE id = $1", session_id)
        .execute(exec)
        .await?;
    Ok(())
}

/// 본인 세션일 때만 삭제. 삭제 여부 반환.
pub async fn delete_for_user(
    exec: impl PgExecutor<'_>,
    user_id: Uuid,
    session_id: Uuid,
) -> AppResult<bool> {
    let result = sqlx::query!(
        "DELETE FROM sessions WHERE id = $1 AND user_id = $2",
        session_id,
        user_id,
    )
    .execute(exec)
    .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn delete_all_for_user(exec: impl PgExecutor<'_>, user_id: Uuid) -> AppResult<()> {
    sqlx::query!("DELETE FROM sessions WHERE user_id = $1", user_id)
        .execute(exec)
        .await?;
    Ok(())
}

/// `keep` 외 해당 사용자 세션 전부 삭제.
pub async fn delete_all_except(
    exec: impl PgExecutor<'_>,
    user_id: Uuid,
    keep: Uuid,
) -> AppResult<()> {
    sqlx::query!(
        "DELETE FROM sessions WHERE user_id = $1 AND id <> $2",
        user_id,
        keep,
    )
    .execute(exec)
    .await?;
    Ok(())
}

/// 만료 세션 삭제. 삭제 건수 반환.
pub async fn delete_expired(exec: impl PgExecutor<'_>) -> AppResult<u64> {
    let result = sqlx::query!("DELETE FROM sessions WHERE expires_at <= now()")
        .execute(exec)
        .await?;
    Ok(result.rows_affected())
}

/// 만료 세션 제외. 최근 사용 순.
pub async fn list_for_user(
    exec: impl PgExecutor<'_>,
    user_id: Uuid,
    current_session_id: Uuid,
) -> AppResult<Vec<SessionInfo>> {
    let sessions = sqlx::query_as!(
        SessionInfo,
        r#"SELECT id, user_agent, created_at, last_seen_at, id = $2 AS "current!"
           FROM sessions
           WHERE user_id = $1 AND expires_at > now()
           ORDER BY last_seen_at DESC, id DESC"#,
        user_id,
        current_session_id,
    )
    .fetch_all(exec)
    .await?;
    Ok(sessions)
}

pub fn cookie(config: &Config, raw: String) -> Cookie<'static> {
    // 30일은 time::Duration 범위 내. 변환 실패 불가.
    let max_age = std::time::Duration::from_secs(TTL_SECS)
        .try_into()
        .unwrap_or_else(|_| unreachable!());
    Cookie::build((COOKIE_NAME, raw))
        .http_only(true)
        .same_site(SameSite::Lax)
        .path("/")
        .secure(config.public_url.starts_with("https://"))
        .max_age(max_age)
        .build()
}

/// 발급 쿠키와 같은 이름/경로/속성. 빈 값, Max-Age 0.
pub fn clear_cookie(config: &Config) -> Cookie<'static> {
    let mut cookie = cookie(config, String::new());
    cookie.make_removal();
    cookie
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn config(public_url: &str) -> Config {
        Config {
            database_url: String::new(),
            public_url: public_url.to_string(),
            secret_key: vec![0; 32],
            data_dir: PathBuf::new(),
            port: 0,
            auto_migrate: false,
            worker_concurrency: 1,
        }
    }

    #[test]
    fn cookie_secure_follows_public_url_scheme() {
        let https = config("https://x.example");
        assert_eq!(cookie(&https, "t".into()).secure(), Some(true));
        assert_eq!(clear_cookie(&https).secure(), Some(true));

        let http = config("http://localhost");
        assert_ne!(cookie(&http, "t".into()).secure(), Some(true));
        assert_ne!(clear_cookie(&http).secure(), Some(true));
    }

    #[test]
    fn cookie_attributes() {
        let c = cookie(&config("http://localhost"), "raw".into());
        assert_eq!(c.name(), COOKIE_NAME);
        assert_eq!(c.value(), "raw");
        assert_eq!(c.http_only(), Some(true));
        assert_eq!(c.same_site(), Some(SameSite::Lax));
        assert_eq!(c.path(), Some("/"));
        assert_eq!(
            c.max_age().map(|d| d.whole_seconds()),
            Some(TTL_SECS as i64)
        );

        let cleared = clear_cookie(&config("http://localhost"));
        assert_eq!(cleared.name(), COOKIE_NAME);
        assert_eq!(cleared.value(), "");
        assert_eq!(cleared.path(), Some("/"));
        assert_eq!(cleared.max_age().map(|d| d.whole_seconds()), Some(0));
    }
}
