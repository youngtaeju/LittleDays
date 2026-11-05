mod common;

use axum::http::StatusCode;
use axum_extra::extract::cookie::Cookie;
use axum_test::{TestResponse, TestServer};
use chrono::{DateTime, Duration, Utc};
use common::{XRW, XRW_VALUE, assert_error, server_as, signup};
use littledays::{auth::session, users::Role};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

/// owner `mom` 가입 후 쿠키 저장 서버.
async fn owner_server(pool: &PgPool) -> TestServer {
    let server = common::test_server(pool.clone()).await;
    signup(&server).await;
    server
}

async fn create_invite(server: &TestServer, body: Value) -> TestResponse {
    server
        .post("/api/invites")
        .add_header(XRW, XRW_VALUE)
        .json(&body)
        .await
}

/// 초대 생성. (invite JSON, 원문 토큰)
async fn invite(server: &TestServer, role: &str) -> (Value, String) {
    let res = create_invite(server, json!({ "role": role })).await;
    res.assert_status(StatusCode::CREATED);
    let body: Value = res.json();
    let url = body["url"].as_str().expect("url");
    let raw = url
        .strip_prefix("http://localhost/invite/")
        .expect("url prefix")
        .to_string();
    (body["invite"].clone(), raw)
}

fn accept_body(username: &str) -> Value {
    json!({ "username": username, "password": "password123", "display_name": "아빠" })
}

async fn accept(server: &TestServer, raw: &str, body: Value) -> TestResponse {
    server
        .post(&format!("/api/invites/{raw}/accept"))
        .json(&body)
        .await
}

async fn preview(server: &TestServer, raw: &str) -> TestResponse {
    server.get(&format!("/api/invites/{raw}/preview")).await
}

async fn revoke(server: &TestServer, id: &str) -> TestResponse {
    server
        .delete(&format!("/api/invites/{id}"))
        .add_header(XRW, XRW_VALUE)
        .await
}

async fn list(server: &TestServer) -> Vec<Value> {
    let res = server.get("/api/invites").await;
    res.assert_status_ok();
    res.json::<Value>()["invites"]
        .as_array()
        .expect("invites")
        .clone()
}

async fn status_of(server: &TestServer, id: &Value) -> Value {
    list(server)
        .await
        .into_iter()
        .find(|i| &i["id"] == id)
        .expect("invite listed")["status"]
        .clone()
}

fn timestamp(v: &Value) -> DateTime<Utc> {
    serde_json::from_value(v.clone()).expect("timestamp")
}

fn assert_close(actual: DateTime<Utc>, expected: DateTime<Utc>) {
    let diff = (actual - expected).num_seconds().abs();
    assert!(diff < 60, "{actual} vs {expected}");
}

#[sqlx::test(migrations = "./migrations")]
async fn owner_creates_invite_and_guest_accepts(pool: PgPool) {
    let owner = owner_server(&pool).await;
    let owner_id = owner.get("/api/auth/me").await.json::<Value>()["user"]["id"].clone();

    let (invite, raw) = invite(&owner, "guardian").await;
    assert_eq!(raw.len(), 43);
    assert_eq!(invite["role"], "guardian");
    assert_eq!(invite["status"], "active");
    assert_eq!(invite["created_by"], owner_id);
    assert!(invite["used_by"].is_null());
    assert!(invite["used_at"].is_null());
    assert!(invite["revoked_at"].is_null());
    assert!(invite.get("token_hash").is_none());
    assert_close(
        timestamp(&invite["expires_at"]),
        Utc::now() + Duration::hours(72),
    );

    let guest = common::test_server(pool.clone()).await;
    let res = preview(&guest, &raw).await;
    res.assert_status_ok();
    res.assert_json(&json!({
        "role": "guardian",
        "instance_name": "우리집",
        "expires_at": invite["expires_at"],
    }));

    let res = accept(&guest, &raw, accept_body("Dad")).await;
    res.assert_status(StatusCode::CREATED);
    let accepted: Value = res.json();
    assert_eq!(accepted["user"]["role"], "guardian");
    assert_eq!(accepted["user"]["username"], "dad");
    assert_eq!(accepted["user"]["display_name"], "아빠");
    assert_eq!(accepted["user"]["locale"], "ko");
    assert!(accepted["user"].get("password_hash").is_none());
    assert_eq!(res.cookie(session::COOKIE_NAME).value().len(), 43);

    let me = guest.get("/api/auth/me").await;
    me.assert_status_ok();
    me.assert_json(&accepted);

    // 발급 비밀번호로 재로그인 가능.
    common::test_server_without_cookies(pool)
        .await
        .post("/api/auth/login")
        .json(&json!({ "username": "dad", "password": "password123" }))
        .await
        .assert_status_ok();

    let listed = list(&owner).await;
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0]["status"], "used");
    assert_eq!(listed[0]["used_by"], accepted["user"]["id"]);
    assert!(listed[0]["used_at"].is_string());
}

#[sqlx::test(migrations = "./migrations")]
async fn guardian_cannot_create_invite(pool: PgPool) {
    let owner = owner_server(&pool).await;
    let (invite, _) = invite(&owner, "family").await;
    let (guardian, _) = server_as(&pool, "dad", Role::Guardian).await;

    let res = create_invite(&guardian, json!({ "role": "family" })).await;
    assert_error(&res, StatusCode::FORBIDDEN, "auth.forbidden");
    let res = guardian.get("/api/invites").await;
    assert_error(&res, StatusCode::FORBIDDEN, "auth.forbidden");
    let res = revoke(&guardian, invite["id"].as_str().expect("id")).await;
    assert_error(&res, StatusCode::FORBIDDEN, "auth.forbidden");
    assert_eq!(status_of(&owner, &invite["id"]).await, "active");
}

#[sqlx::test(migrations = "./migrations")]
async fn invite_management_requires_auth(pool: PgPool) {
    let server = common::test_server_without_cookies(pool).await;
    let res = server
        .post("/api/invites")
        .json(&json!({ "role": "family" }))
        .await;
    assert_error(&res, StatusCode::UNAUTHORIZED, "auth.required");
    let res = server.get("/api/invites").await;
    assert_error(&res, StatusCode::UNAUTHORIZED, "auth.required");
}

#[sqlx::test(migrations = "./migrations")]
async fn create_invite_requires_csrf_header(pool: PgPool) {
    let owner = owner_server(&pool).await;
    let res = owner
        .post("/api/invites")
        .json(&json!({ "role": "family" }))
        .await;
    assert_error(&res, StatusCode::FORBIDDEN, "auth.csrf");
    assert!(list(&owner).await.is_empty());
}

#[sqlx::test(migrations = "./migrations")]
async fn expired_invite_is_410(pool: PgPool) {
    let owner = owner_server(&pool).await;
    let res = create_invite(&owner, json!({ "role": "family", "expires_in_hours": 1 })).await;
    res.assert_status(StatusCode::CREATED);
    let invite = res.json::<Value>()["invite"].clone();
    assert_close(
        timestamp(&invite["expires_at"]),
        Utc::now() + Duration::hours(1),
    );
    let raw = res.json::<Value>()["url"]
        .as_str()
        .expect("url")
        .rsplit('/')
        .next()
        .expect("raw")
        .to_string();

    sqlx::query!("UPDATE invites SET expires_at = now() - interval '1 hour'")
        .execute(&pool)
        .await
        .expect("expire");

    let guest = common::test_server(pool.clone()).await;
    assert_error(
        &preview(&guest, &raw).await,
        StatusCode::GONE,
        "invite.expired",
    );
    let res = accept(&guest, &raw, accept_body("dad")).await;
    assert_error(&res, StatusCode::GONE, "invite.expired");
    assert_eq!(status_of(&owner, &invite["id"]).await, "expired");
}

#[sqlx::test(migrations = "./migrations")]
async fn used_invite_is_410(pool: PgPool) {
    let owner = owner_server(&pool).await;
    let (_, raw) = invite(&owner, "family").await;
    let guest = common::test_server_without_cookies(pool).await;

    accept(&guest, &raw, accept_body("dad"))
        .await
        .assert_status(StatusCode::CREATED);
    let res = accept(&guest, &raw, accept_body("grandma")).await;
    assert_error(&res, StatusCode::GONE, "invite.used");
    assert!(res.maybe_cookie(session::COOKIE_NAME).is_none());
    assert_error(
        &preview(&guest, &raw).await,
        StatusCode::GONE,
        "invite.used",
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn revoked_invite_is_410(pool: PgPool) {
    let owner = owner_server(&pool).await;
    let (invite, raw) = invite(&owner, "family").await;
    let id = invite["id"].as_str().expect("id");

    revoke(&owner, id)
        .await
        .assert_status(StatusCode::NO_CONTENT);
    let listed = list(&owner).await;
    assert_eq!(listed[0]["status"], "revoked");
    let revoked_at = listed[0]["revoked_at"].clone();
    assert!(revoked_at.is_string());

    let guest = common::test_server_without_cookies(pool).await;
    assert_error(
        &preview(&guest, &raw).await,
        StatusCode::GONE,
        "invite.revoked",
    );
    let res = accept(&guest, &raw, accept_body("dad")).await;
    assert_error(&res, StatusCode::GONE, "invite.revoked");

    // 재회수는 멱등. 최초 회수 시각 유지.
    revoke(&owner, id)
        .await
        .assert_status(StatusCode::NO_CONTENT);
    assert_eq!(list(&owner).await[0]["revoked_at"], revoked_at);
}

#[sqlx::test(migrations = "./migrations")]
async fn revoke_unknown_is_404(pool: PgPool) {
    let owner = owner_server(&pool).await;
    let res = revoke(&owner, &Uuid::now_v7().to_string()).await;
    assert_error(&res, StatusCode::NOT_FOUND, "invite.notFound");
    let res = revoke(&owner, "not-a-uuid").await;
    assert_error(&res, StatusCode::BAD_REQUEST, "request.invalidPath");
}

#[sqlx::test(migrations = "./migrations")]
async fn revoke_used_is_409(pool: PgPool) {
    let owner = owner_server(&pool).await;
    let (invite, raw) = invite(&owner, "family").await;
    let guest = common::test_server_without_cookies(pool).await;
    accept(&guest, &raw, accept_body("dad"))
        .await
        .assert_status(StatusCode::CREATED);

    let res = revoke(&owner, invite["id"].as_str().expect("id")).await;
    assert_error(&res, StatusCode::CONFLICT, "invite.used");
    let listed = list(&owner).await;
    assert_eq!(listed[0]["status"], "used");
    assert!(listed[0]["revoked_at"].is_null());
}

#[sqlx::test(migrations = "./migrations")]
async fn accept_duplicate_username_409(pool: PgPool) {
    let owner = owner_server(&pool).await;
    let (invite, raw) = invite(&owner, "guardian").await;
    let guest = common::test_server_without_cookies(pool).await;

    let res = accept(&guest, &raw, accept_body("MOM")).await;
    assert_error(&res, StatusCode::CONFLICT, "auth.usernameTaken");
    assert!(res.maybe_cookie(session::COOKIE_NAME).is_none());
    assert_eq!(status_of(&owner, &invite["id"]).await, "active");

    preview(&guest, &raw).await.assert_status_ok();
    accept(&guest, &raw, accept_body("dad"))
        .await
        .assert_status(StatusCode::CREATED);
}

#[sqlx::test(migrations = "./migrations")]
async fn accept_validates_input(pool: PgPool) {
    let owner = owner_server(&pool).await;
    let (invite, raw) = invite(&owner, "family").await;
    let guest = common::test_server_without_cookies(pool).await;
    let bad = StatusCode::BAD_REQUEST;

    let cases = [
        (json!({ "username": "ab" }), "auth.usernameInvalid"),
        (json!({ "username": "bad name!" }), "auth.usernameInvalid"),
        (json!({ "password": "short" }), "auth.passwordTooShort"),
        (json!({ "display_name": "   " }), "auth.displayNameInvalid"),
        (
            json!({ "display_name": "가".repeat(65) }),
            "auth.displayNameInvalid",
        ),
    ];
    for (patch, key) in cases {
        let mut body = accept_body("dad");
        for (k, v) in patch.as_object().expect("patch") {
            body[k] = v.clone();
        }
        assert_error(&accept(&guest, &raw, body).await, bad, key);
    }
    let res = accept(&guest, &raw, json!({ "username": "dad" })).await;
    assert_error(&res, bad, "request.invalidBody");
    assert_eq!(status_of(&owner, &invite["id"]).await, "active");

    // 이름 앞뒤 공백 제거.
    let mut body = accept_body("dad");
    body["display_name"] = json!("  아빠  ");
    let res = accept(&guest, &raw, body).await;
    res.assert_status(StatusCode::CREATED);
    assert_eq!(res.json::<Value>()["user"]["display_name"], "아빠");
}

#[sqlx::test(migrations = "./migrations")]
async fn owner_role_invite_rejected(pool: PgPool) {
    let owner = owner_server(&pool).await;
    let res = create_invite(&owner, json!({ "role": "owner" })).await;
    assert_error(&res, StatusCode::BAD_REQUEST, "invite.roleNotAllowed");
    let res = create_invite(&owner, json!({ "role": "admin" })).await;
    assert_error(&res, StatusCode::BAD_REQUEST, "request.invalidBody");
    assert!(list(&owner).await.is_empty());
}

#[sqlx::test(migrations = "./migrations")]
async fn invalid_expiry_is_400(pool: PgPool) {
    let owner = owner_server(&pool).await;
    for hours in [0, 721] {
        let res = create_invite(
            &owner,
            json!({ "role": "family", "expires_in_hours": hours }),
        )
        .await;
        assert_error(&res, StatusCode::BAD_REQUEST, "invite.invalidExpiry");
    }
    let res = create_invite(&owner, json!({ "role": "family", "expires_in_hours": -1 })).await;
    assert_error(&res, StatusCode::BAD_REQUEST, "request.invalidBody");
    assert!(list(&owner).await.is_empty());

    let res = create_invite(&owner, json!({ "role": "family", "expires_in_hours": 720 })).await;
    res.assert_status(StatusCode::CREATED);
    let expires_at = timestamp(&res.json::<Value>()["invite"]["expires_at"]);
    assert_close(expires_at, Utc::now() + Duration::hours(720));
}

#[sqlx::test(migrations = "./migrations")]
async fn list_is_newest_first_with_status(pool: PgPool) {
    let owner = owner_server(&pool).await;
    let (expired, _) = invite(&owner, "family").await;
    let (revoked, _) = invite(&owner, "guardian").await;
    let (used, used_raw) = invite(&owner, "family").await;
    let (active, _) = invite(&owner, "guardian").await;

    sqlx::query!(
        "UPDATE invites SET expires_at = now() - interval '1 second' WHERE id = $1",
        Uuid::parse_str(expired["id"].as_str().expect("id")).expect("uuid"),
    )
    .execute(&pool)
    .await
    .expect("expire");
    // DB 시계 보정 영향 배제. 생성 시각 명시.
    for (invite, age) in [
        (&expired, "4 hours"),
        (&revoked, "3 hours"),
        (&used, "2 hours"),
        (&active, "1 hour"),
    ] {
        sqlx::query("UPDATE invites SET created_at = now() - $1::interval WHERE id = $2")
            .bind(age)
            .bind(Uuid::parse_str(invite["id"].as_str().expect("id")).expect("uuid"))
            .execute(&pool)
            .await
            .expect("set created_at");
    }
    revoke(&owner, revoked["id"].as_str().expect("id"))
        .await
        .assert_status(StatusCode::NO_CONTENT);
    let guest = common::test_server_without_cookies(pool).await;
    accept(&guest, &used_raw, accept_body("dad"))
        .await
        .assert_status(StatusCode::CREATED);

    let listed = list(&owner).await;
    let summary: Vec<(Value, Value)> = listed
        .iter()
        .map(|i| (i["id"].clone(), i["status"].clone()))
        .collect();
    assert_eq!(
        summary,
        vec![
            (active["id"].clone(), json!("active")),
            (used["id"].clone(), json!("used")),
            (revoked["id"].clone(), json!("revoked")),
            (expired["id"].clone(), json!("expired")),
        ]
    );
    assert!(listed.iter().all(|i| i.get("token_hash").is_none()));
}

#[sqlx::test(migrations = "./migrations")]
async fn accept_is_csrf_exempt(pool: PgPool) {
    let owner = owner_server(&pool).await;
    let (_, raw) = invite(&owner, "family").await;
    let guest = common::test_server_without_cookies(pool).await;

    let res = guest
        .post(&format!("/api/invites/{raw}/accept"))
        .add_cookie(Cookie::new(session::COOKIE_NAME, "stale"))
        .json(&accept_body("dad"))
        .await;
    res.assert_status(StatusCode::CREATED);
    assert_ne!(res.cookie(session::COOKIE_NAME).value(), "stale");
}

#[sqlx::test(migrations = "./migrations")]
async fn unknown_invite_is_404(pool: PgPool) {
    let server = common::test_server_without_cookies(pool).await;
    assert_error(
        &preview(&server, "no-such-token").await,
        StatusCode::NOT_FOUND,
        "invite.notFound",
    );
    let res = accept(&server, "no-such-token", accept_body("dad")).await;
    assert_error(&res, StatusCode::NOT_FOUND, "invite.notFound");
}

#[sqlx::test(migrations = "./migrations")]
async fn concurrent_accept_only_one_wins(pool: PgPool) {
    let owner = owner_server(&pool).await;
    let (_, raw) = invite(&owner, "family").await;
    let guest = common::test_server_without_cookies(pool.clone()).await;

    let (a, b) = tokio::join!(
        accept(&guest, &raw, accept_body("dad")),
        accept(&guest, &raw, accept_body("grandma")),
    );
    let mut statuses = [a.status_code(), b.status_code()];
    statuses.sort();
    assert_eq!(statuses, [StatusCode::CREATED, StatusCode::GONE]);
    let users: i64 = sqlx::query_scalar!(r#"SELECT count(*) AS "n!" FROM users"#)
        .fetch_one(&pool)
        .await
        .expect("count");
    assert_eq!(users, 2);
}

#[sqlx::test(migrations = "./migrations")]
async fn accept_uses_default_locale_setting(pool: PgPool) {
    let owner = owner_server(&pool).await;
    owner
        .patch("/api/settings")
        .add_header(XRW, XRW_VALUE)
        .json(&json!({ "default_locale": "en" }))
        .await
        .assert_status_ok();
    let (_, raw) = invite(&owner, "family").await;

    let guest = common::test_server_without_cookies(pool).await;
    let res = accept(&guest, &raw, accept_body("dad")).await;
    res.assert_status(StatusCode::CREATED);
    assert_eq!(res.json::<Value>()["user"]["locale"], "en");
}

#[sqlx::test(migrations = "./migrations")]
async fn openapi_documents_invite_endpoints(pool: PgPool) {
    let server = common::test_server(pool).await;
    let doc: Value = server.get("/api/openapi.json").await.json();
    let paths = &doc["paths"];
    for (path, method, op) in [
        ("/api/invites", "post", "create_invite"),
        ("/api/invites", "get", "list_invites"),
        ("/api/invites/{id}", "delete", "revoke_invite"),
        ("/api/invites/{raw}/preview", "get", "preview_invite"),
        ("/api/invites/{raw}/accept", "post", "accept_invite"),
    ] {
        assert_eq!(paths[path][method]["operationId"], op, "{method} {path}");
    }
    let error_ref = json!("#/components/schemas/ErrorBody");
    assert_eq!(
        paths["/api/invites/{raw}/accept"]["post"]["responses"]["410"]["content"]["application/json"]
            ["schema"]["$ref"],
        error_ref
    );
    assert_eq!(
        paths["/api/auth/login"]["post"]["responses"]["401"]["content"]["application/json"]["schema"]
            ["$ref"],
        error_ref
    );
    assert!(doc["components"]["schemas"]["ErrorBody"].is_object());

    let schemas = &doc["components"]["schemas"];
    let required = |name: &str, field: &str| {
        schemas[name]["required"]
            .as_array()
            .is_some_and(|r| r.contains(&json!(field)))
    };
    for (name, field) in [
        ("User", "email"),
        ("User", "disabled_at"),
        ("Invite", "used_by"),
        ("Invite", "used_at"),
        ("Invite", "revoked_at"),
        ("SessionInfo", "user_agent"),
    ] {
        assert!(required(name, field), "{name}.{field} required");
    }
    let expiry = &schemas["CreateInviteRequest"]["properties"]["expires_in_hours"];
    assert_eq!(expiry["minimum"], 1);
    assert_eq!(expiry["maximum"], 720);
    assert_eq!(
        schemas["ErrorBody"]["properties"]["params"]["type"],
        "object"
    );
}
