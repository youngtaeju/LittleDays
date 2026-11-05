mod common;

use axum::http::{HeaderValue, StatusCode};
use axum_extra::extract::cookie::{Cookie, SameSite};
use axum_test::TestResponse;
use chrono::Utc;
use common::{XRW, XRW_VALUE, assert_error, login, login_body, signup, signup_body};
use littledays::{
    auth::{session, token},
    users::{self, NewUser, Role},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

async fn session_count(pool: &PgPool) -> i64 {
    sqlx::query_scalar!(r#"SELECT count(*) AS "n!" FROM sessions"#)
        .fetch_one(pool)
        .await
        .expect("count")
}

#[sqlx::test(migrations = "./migrations")]
async fn login_sets_cookie_and_me_works(pool: PgPool) {
    let server = common::test_server(pool).await;
    signup(&server).await;

    let res = server
        .post("/api/auth/logout")
        .add_header(XRW, XRW_VALUE)
        .await;
    res.assert_status(StatusCode::NO_CONTENT);
    let cleared = res.cookie(session::COOKIE_NAME);
    assert_eq!(cleared.value(), "");
    assert_eq!(cleared.max_age().map(|d| d.whole_seconds()), Some(0));
    assert_eq!(cleared.path(), Some("/"));

    let res = server
        .post("/api/auth/login")
        .json(&json!({ "username": "MOM", "password": "password123" }))
        .await;
    res.assert_status_ok();
    let login_user: Value = res.json();
    assert_eq!(login_user["user"]["username"], "mom");
    assert!(login_user["user"].get("password_hash").is_none());

    let cookie = res.cookie(session::COOKIE_NAME);
    assert_eq!(cookie.value().len(), 43);
    assert_eq!(cookie.http_only(), Some(true));
    assert_eq!(cookie.same_site(), Some(SameSite::Lax));
    assert_eq!(cookie.path(), Some("/"));
    assert_eq!(
        cookie.max_age().map(|d| d.whole_seconds()),
        Some(30 * 24 * 3600)
    );
    assert_ne!(cookie.secure(), Some(true));

    let me = server.get("/api/auth/me").await;
    me.assert_status_ok();
    me.assert_json(&login_user);
}

#[sqlx::test(migrations = "./migrations")]
async fn login_wrong_password_401(pool: PgPool) {
    let server = common::test_server_without_cookies(pool.clone()).await;
    signup(&server).await;
    let before = session_count(&pool).await;

    let res = server
        .post("/api/auth/login")
        .json(&login_body("wrong-password"))
        .await;
    assert_error(&res, StatusCode::UNAUTHORIZED, "auth.invalidCredentials");
    assert!(res.maybe_cookie(session::COOKIE_NAME).is_none());
    assert_eq!(session_count(&pool).await, before);
}

#[sqlx::test(migrations = "./migrations")]
async fn login_unknown_user_401(pool: PgPool) {
    let server = common::test_server_without_cookies(pool).await;
    signup(&server).await;

    let res = server
        .post("/api/auth/login")
        .json(&json!({ "username": "nobody", "password": "password123" }))
        .await;
    assert_error(&res, StatusCode::UNAUTHORIZED, "auth.invalidCredentials");
}

#[sqlx::test(migrations = "./migrations")]
async fn login_rejects_malformed_body(pool: PgPool) {
    let server = common::test_server_without_cookies(pool).await;
    let res = server
        .post("/api/auth/login")
        .json(&json!({ "username": "mom" }))
        .await;
    assert_error(&res, StatusCode::BAD_REQUEST, "request.invalidBody");
}

#[sqlx::test(migrations = "./migrations")]
async fn signup_and_login_are_csrf_exempt(pool: PgPool) {
    let server = common::test_server_without_cookies(pool).await;
    let stale = Cookie::new(session::COOKIE_NAME, "stale");

    server
        .post("/api/auth/signup")
        .add_cookie(stale.clone())
        .json(&signup_body())
        .await
        .assert_status(StatusCode::CREATED);
    server
        .post("/api/auth/login")
        .add_cookie(stale.clone())
        .json(&login_body("password123"))
        .await
        .assert_status_ok();

    // 예외 외 경로는 인증 전에 CSRF 차단.
    let res = server.post("/api/auth/logout").add_cookie(stale).await;
    assert_error(&res, StatusCode::FORBIDDEN, "auth.csrf");
}

#[sqlx::test(migrations = "./migrations")]
async fn bearer_auth_works_without_csrf(pool: PgPool) {
    let server = common::test_server_without_cookies(pool).await;
    signup(&server).await;
    let raw = login(&server, "cli").await.value().to_string();

    let res = server
        .post("/api/auth/media-token")
        .authorization_bearer(&raw)
        .await;
    res.assert_status_ok();

    let me = server.get("/api/auth/me").authorization_bearer(&raw).await;
    me.assert_status_ok();
    assert_eq!(me.json::<Value>()["user"]["username"], "mom");
}

#[sqlx::test(migrations = "./migrations")]
async fn basic_authorization_uses_cookie_and_csrf(pool: PgPool) {
    let server = common::test_server(pool).await;
    signup(&server).await;
    const BASIC: &str = "Basic bW9tOnBhc3N3b3JkMTIz";

    server
        .get("/api/auth/me")
        .authorization(BASIC)
        .await
        .assert_status_ok();

    let res = server
        .post("/api/auth/media-token")
        .authorization(BASIC)
        .await;
    assert_error(&res, StatusCode::FORBIDDEN, "auth.csrf");

    server
        .post("/api/auth/media-token")
        .authorization(BASIC)
        .add_header(XRW, XRW_VALUE)
        .await
        .assert_status_ok();
}

#[sqlx::test(migrations = "./migrations")]
async fn bearer_with_cookie_is_csrf_exempt(pool: PgPool) {
    let server = common::test_server(pool).await;
    signup(&server).await;
    let raw = login(&server, "cli").await.value().to_string();

    server
        .post("/api/auth/media-token")
        .authorization_bearer(&raw)
        .await
        .assert_status_ok();

    // 스킴 대소문자 무시.
    server
        .post("/api/auth/media-token")
        .authorization(format!("bearer {raw}"))
        .await
        .assert_status_ok();
}

#[sqlx::test(migrations = "./migrations")]
async fn invalid_bearer_never_falls_back_to_cookie(pool: PgPool) {
    let server = common::test_server(pool).await;
    signup(&server).await;

    for value in ["Bearer unknown-token", "Bearer ", "Bearer"] {
        let res = server.get("/api/auth/me").authorization(value).await;
        assert_error(&res, StatusCode::UNAUTHORIZED, "auth.required");
    }

    server.get("/api/auth/me").await.assert_status_ok();
}

#[sqlx::test(migrations = "./migrations")]
async fn me_without_credentials_401(pool: PgPool) {
    let server = common::test_server_without_cookies(pool).await;
    let res = server.get("/api/auth/me").await;
    assert_error(&res, StatusCode::UNAUTHORIZED, "auth.required");
}

#[sqlx::test(migrations = "./migrations")]
async fn cookie_post_without_header_is_403(pool: PgPool) {
    let server = common::test_server(pool).await;
    signup(&server).await;

    let res = server.post("/api/auth/media-token").await;
    assert_error(&res, StatusCode::FORBIDDEN, "auth.csrf");

    let res = server
        .post("/api/auth/media-token")
        .add_header(XRW, HeaderValue::from_static("XMLHttpRequest"))
        .await;
    assert_error(&res, StatusCode::FORBIDDEN, "auth.csrf");

    server
        .post("/api/auth/media-token")
        .add_header(XRW, XRW_VALUE)
        .await
        .assert_status_ok();
}

#[sqlx::test(migrations = "./migrations")]
async fn disabled_user_session_rejected(pool: PgPool) {
    let server = common::test_server(pool.clone()).await;
    signup(&server).await;
    assert_eq!(session_count(&pool).await, 1);

    sqlx::query!("UPDATE users SET disabled_at = now()")
        .execute(&pool)
        .await
        .expect("disable");

    let res = server.get("/api/auth/me").await;
    assert_error(&res, StatusCode::UNAUTHORIZED, "auth.disabled");
    assert_eq!(session_count(&pool).await, 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn disabled_user_cannot_login(pool: PgPool) {
    let server = common::test_server_without_cookies(pool.clone()).await;
    signup(&server).await;
    sqlx::query!("UPDATE users SET disabled_at = now()")
        .execute(&pool)
        .await
        .expect("disable");
    let before = session_count(&pool).await;

    let res = server
        .post("/api/auth/login")
        .json(&login_body("password123"))
        .await;
    assert_error(&res, StatusCode::UNAUTHORIZED, "auth.disabled");
    assert_eq!(session_count(&pool).await, before);

    // 비밀번호가 틀리면 계정 상태 비노출.
    let res = server
        .post("/api/auth/login")
        .json(&login_body("wrong-password"))
        .await;
    assert_error(&res, StatusCode::UNAUTHORIZED, "auth.invalidCredentials");
}

#[sqlx::test(migrations = "./migrations")]
async fn logout_invalidates_session(pool: PgPool) {
    let server = common::test_server_without_cookies(pool.clone()).await;
    let cookie = signup(&server).await;

    server
        .post("/api/auth/logout")
        .add_cookie(cookie.clone())
        .add_header(XRW, XRW_VALUE)
        .await
        .assert_status(StatusCode::NO_CONTENT);
    assert_eq!(session_count(&pool).await, 0);

    let res = server.get("/api/auth/me").add_cookie(cookie).await;
    assert_error(&res, StatusCode::UNAUTHORIZED, "auth.required");
}

fn assert_cleared(res: &TestResponse) {
    res.assert_status(StatusCode::NO_CONTENT);
    let cleared = res.cookie(session::COOKIE_NAME);
    assert_eq!(cleared.value(), "");
    assert_eq!(cleared.max_age().map(|d| d.whole_seconds()), Some(0));
}

#[sqlx::test(migrations = "./migrations")]
async fn logout_without_valid_session_still_clears_cookie(pool: PgPool) {
    let server = common::test_server_without_cookies(pool.clone()).await;
    let cookie = signup(&server).await;

    let res = server
        .post("/api/auth/logout")
        .add_cookie(Cookie::new(session::COOKIE_NAME, "stale"))
        .add_header(XRW, XRW_VALUE)
        .await;
    assert_cleared(&res);
    assert_eq!(session_count(&pool).await, 1);

    assert_cleared(&server.post("/api/auth/logout").await);

    // 비활성 사용자 세션은 삭제 후 쿠키 제거.
    sqlx::query!("UPDATE users SET disabled_at = now()")
        .execute(&pool)
        .await
        .expect("disable");
    let res = server
        .post("/api/auth/logout")
        .add_cookie(cookie)
        .add_header(XRW, XRW_VALUE)
        .await;
    assert_cleared(&res);
    assert_eq!(session_count(&pool).await, 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn logout_with_expired_session_clears_cookie(pool: PgPool) {
    let server = common::test_server_without_cookies(pool.clone()).await;
    let cookie = signup(&server).await;
    sqlx::query!("UPDATE sessions SET expires_at = now() - interval '1 second'")
        .execute(&pool)
        .await
        .expect("expire");

    let res = server
        .post("/api/auth/logout")
        .add_cookie(cookie)
        .add_header(XRW, XRW_VALUE)
        .await;
    assert_cleared(&res);
}

#[sqlx::test(migrations = "./migrations")]
async fn expired_session_rejected(pool: PgPool) {
    let server = common::test_server(pool.clone()).await;
    signup(&server).await;
    sqlx::query!("UPDATE sessions SET expires_at = now() - interval '1 second'")
        .execute(&pool)
        .await
        .expect("expire");

    let res = server.get("/api/auth/me").await;
    assert_error(&res, StatusCode::UNAUTHORIZED, "auth.required");
}

#[sqlx::test(migrations = "./migrations")]
async fn touch_extends_session_at_most_hourly(pool: PgPool) {
    let server = common::test_server(pool.clone()).await;
    signup(&server).await;

    // 최근 1시간 이내 사용 → 갱신 생략.
    sqlx::query!("UPDATE sessions SET expires_at = now() + interval '1 day'")
        .execute(&pool)
        .await
        .expect("shorten");
    server.get("/api/auth/me").await.assert_status_ok();
    let extended: bool = sqlx::query_scalar!(
        r#"SELECT expires_at > now() + interval '29 days' AS "v!" FROM sessions"#
    )
    .fetch_one(&pool)
    .await
    .expect("expires_at");
    assert!(!extended);

    sqlx::query!("UPDATE sessions SET last_seen_at = now() - interval '2 hours'")
        .execute(&pool)
        .await
        .expect("age");
    server.get("/api/auth/me").await.assert_status_ok();
    let row = sqlx::query!(
        r#"SELECT expires_at > now() + interval '29 days' AS "extended!",
                  last_seen_at > now() - interval '1 minute' AS "seen!"
           FROM sessions"#
    )
    .fetch_one(&pool)
    .await
    .expect("session");
    assert!(row.extended);
    assert!(row.seen);
}

#[sqlx::test(migrations = "./migrations")]
async fn sessions_list_and_revoke(pool: PgPool) {
    let server = common::test_server_without_cookies(pool.clone()).await;
    let signup_cookie = signup(&server).await;
    server
        .post("/api/auth/logout")
        .add_cookie(signup_cookie)
        .add_header(XRW, XRW_VALUE)
        .await
        .assert_status(StatusCode::NO_CONTENT);

    let a = login(&server, "browser-a").await;
    let b = login(&server, "browser-b").await;

    let res = server.get("/api/auth/sessions").add_cookie(a.clone()).await;
    res.assert_status_ok();
    let sessions = res.json::<Value>()["sessions"]
        .as_array()
        .expect("sessions")
        .clone();
    assert_eq!(sessions.len(), 2);
    let current: Vec<&Value> = sessions.iter().filter(|s| s["current"] == true).collect();
    assert_eq!(current.len(), 1);
    assert_eq!(current[0]["user_agent"], "browser-a");
    let other = sessions
        .iter()
        .find(|s| s["current"] == false)
        .expect("other session");
    assert_eq!(other["user_agent"], "browser-b");
    for key in ["id", "created_at", "last_seen_at"] {
        assert!(other[key].is_string(), "{key}");
    }

    let other_id = other["id"].as_str().expect("id");
    server
        .delete(&format!("/api/auth/sessions/{other_id}"))
        .add_cookie(a.clone())
        .add_header(XRW, XRW_VALUE)
        .await
        .assert_status(StatusCode::NO_CONTENT);

    let res = server.get("/api/auth/me").add_cookie(b).await;
    assert_error(&res, StatusCode::UNAUTHORIZED, "auth.required");
    server
        .get("/api/auth/me")
        .add_cookie(a)
        .await
        .assert_status_ok();
}

#[sqlx::test(migrations = "./migrations")]
async fn revoke_rejects_foreign_unknown_and_invalid_ids(pool: PgPool) {
    let server = common::test_server(pool.clone()).await;
    signup(&server).await;

    let other = users::queries::create(
        &pool,
        NewUser {
            username: "dad".to_string(),
            password_hash: "x".to_string(),
            display_name: "아빠".to_string(),
            role: Role::Guardian,
            email: None,
            locale: "ko".to_string(),
        },
    )
    .await
    .expect("other user");
    let (_, foreign_id) = session::create(&pool, other.id, None)
        .await
        .expect("foreign session");

    for id in [foreign_id, Uuid::now_v7()] {
        let res = server
            .delete(&format!("/api/auth/sessions/{id}"))
            .add_header(XRW, XRW_VALUE)
            .await;
        assert_error(&res, StatusCode::NOT_FOUND, "auth.sessionNotFound");
    }
    assert_eq!(session_count(&pool).await, 2);

    let res = server
        .delete("/api/auth/sessions/not-a-uuid")
        .add_header(XRW, XRW_VALUE)
        .await;
    assert_error(&res, StatusCode::BAD_REQUEST, "request.invalidPath");
}

#[sqlx::test(migrations = "./migrations")]
async fn user_agent_is_truncated(pool: PgPool) {
    let server = common::test_server_without_cookies(pool.clone()).await;
    signup(&server).await;
    login(&server, &"a".repeat(600)).await;

    let max: i32 =
        sqlx::query_scalar!(r#"SELECT max(char_length(user_agent)) AS "n!" FROM sessions"#)
            .fetch_one(&pool)
            .await
            .expect("max");
    assert_eq!(max, 512);
}

#[sqlx::test(migrations = "./migrations")]
async fn media_token_verifies(pool: PgPool) {
    let server = common::test_server(pool).await;
    signup(&server).await;
    let me: Value = server.get("/api/auth/me").await.json();
    let user_id = Uuid::parse_str(me["user"]["id"].as_str().expect("id")).expect("uuid");

    let res = server
        .post("/api/auth/media-token")
        .add_header(XRW, XRW_VALUE)
        .await;
    res.assert_status_ok();
    let body: Value = res.json();
    let token = body["token"].as_str().expect("token");
    let expires_at: chrono::DateTime<Utc> =
        serde_json::from_value(body["expires_at"].clone()).expect("expires_at");

    let secret = common::test_config().secret_key;
    let now = Utc::now();
    assert_eq!(token::verify_media(&secret, token, now), Some(user_id));
    let remaining = expires_at - now;
    assert!(remaining > chrono::Duration::minutes(59) && remaining <= chrono::Duration::hours(1));
    assert_eq!(token::verify_media(&secret, token, expires_at), None);
}
