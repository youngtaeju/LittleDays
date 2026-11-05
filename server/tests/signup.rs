mod common;

use axum::http::StatusCode;
use axum_test::TestServer;
use littledays::{
    error::AppError,
    users::{self, NewUser, Role},
};
use serde_json::{Value, json};

fn body(username: &str, password: &str) -> Value {
    json!({
        "username": username,
        "password": password,
        "display_name": "엄마",
        "instance_name": "우리집",
    })
}

async fn assert_signup_error(server: &TestServer, payload: Value, status: StatusCode, key: &str) {
    let res = server.post("/api/auth/signup").json(&payload).await;
    common::assert_error(&res, status, key);
}

#[sqlx::test(migrations = "./migrations")]
async fn first_signup_creates_owner(pool: sqlx::PgPool) {
    let server = common::test_server(pool.clone()).await;

    let res = server
        .post("/api/auth/signup")
        .json(&body("Mom", "password123"))
        .await;
    res.assert_status(StatusCode::CREATED);
    let json: Value = res.json();
    assert_eq!(json["user"]["role"], "owner");
    assert_eq!(json["user"]["username"], "mom");
    assert_eq!(json["user"]["locale"], "ko");
    assert!(json["user"].get("password_hash").is_none());

    let status = server.get("/api/auth/status").await;
    status.assert_status_ok();
    status.assert_json(&json!({ "signup_open": false }));

    let name: Value = sqlx::query_scalar!("SELECT value FROM settings WHERE key = 'instance_name'")
        .fetch_one(&pool)
        .await
        .expect("instance_name");
    assert_eq!(name, json!("우리집"));

    assert_eq!(res.cookie("ld_session").value().len(), 43);
    let me = server.get("/api/auth/me").await;
    me.assert_status_ok();
    me.assert_json(&json);
}

#[sqlx::test(migrations = "./migrations")]
async fn status_is_open_before_signup(pool: sqlx::PgPool) {
    let server = common::test_server(pool).await;
    let res = server.get("/api/auth/status").await;
    res.assert_status_ok();
    res.assert_json(&json!({ "signup_open": true }));
}

#[sqlx::test(migrations = "./migrations")]
async fn second_signup_is_closed(pool: sqlx::PgPool) {
    let server = common::test_server(pool).await;
    server
        .post("/api/auth/signup")
        .json(&body("mom", "password123"))
        .await
        .assert_status(StatusCode::CREATED);
    assert_signup_error(
        &server,
        body("dad", "password123"),
        StatusCode::FORBIDDEN,
        "auth.signupClosed",
    )
    .await;
}

#[sqlx::test(migrations = "./migrations")]
async fn username_case_insensitive_unique(pool: sqlx::PgPool) {
    let server = common::test_server(pool.clone()).await;
    server
        .post("/api/auth/signup")
        .json(&body("Mom", "password123"))
        .await
        .assert_status(StatusCode::CREATED);

    let err = users::queries::create(
        &pool,
        NewUser {
            username: "MOM".to_string(),
            password_hash: "x".to_string(),
            display_name: "다른 엄마".to_string(),
            role: Role::Family,
            email: None,
            locale: "ko".to_string(),
        },
    )
    .await
    .expect_err("duplicate");
    assert!(matches!(err, AppError::Conflict("auth.usernameTaken")));
}

#[sqlx::test(migrations = "./migrations")]
async fn update_role_reports_missing_user(pool: sqlx::PgPool) {
    let user = users::queries::create(
        &pool,
        NewUser {
            username: "dad".to_string(),
            password_hash: "x".to_string(),
            display_name: "아빠".to_string(),
            role: Role::Family,
            email: None,
            locale: "ko".to_string(),
        },
    )
    .await
    .expect("user");

    assert!(
        users::queries::update_role(&pool, user.id, Role::Guardian)
            .await
            .expect("update")
    );
    let updated = users::queries::find_by_id(&pool, user.id)
        .await
        .expect("find")
        .expect("exists");
    assert_eq!(updated.role, Role::Guardian);

    assert!(
        !users::queries::update_role(&pool, uuid::Uuid::now_v7(), Role::Owner)
            .await
            .expect("update missing")
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn concurrent_signup_only_one_wins(pool: sqlx::PgPool) {
    let server = common::test_server(pool).await;
    let (a, b) = tokio::join!(
        server
            .post("/api/auth/signup")
            .json(&body("mom", "password123")),
        server
            .post("/api/auth/signup")
            .json(&body("dad", "password123")),
    );
    let mut statuses = [a.status_code(), b.status_code()];
    statuses.sort();
    assert_eq!(statuses, [StatusCode::CREATED, StatusCode::FORBIDDEN]);
}

#[sqlx::test(migrations = "./migrations")]
async fn signup_validates_input(pool: sqlx::PgPool) {
    let server = common::test_server(pool).await;
    let bad = StatusCode::BAD_REQUEST;

    assert_signup_error(
        &server,
        body("ab", "password123"),
        bad,
        "auth.usernameInvalid",
    )
    .await;
    assert_signup_error(
        &server,
        body("bad name!", "password123"),
        bad,
        "auth.usernameInvalid",
    )
    .await;
    assert_signup_error(
        &server,
        body(&"a".repeat(33), "password123"),
        bad,
        "auth.usernameInvalid",
    )
    .await;
    assert_signup_error(&server, body("mom", "short"), bad, "auth.passwordTooShort").await;

    let mut p = body("mom", "password123");
    p["display_name"] = json!("   ");
    assert_signup_error(&server, p, bad, "auth.displayNameInvalid").await;

    let mut p = body("mom", "password123");
    p["display_name"] = json!("가".repeat(65));
    assert_signup_error(&server, p, bad, "auth.displayNameInvalid").await;

    let mut p = body("mom", "password123");
    p["instance_name"] = json!("");
    assert_signup_error(&server, p, bad, "settings.instanceNameInvalid").await;

    // 글자 수 기준 경계값(64자 한글)은 통과.
    let mut p = body("mom", "password123");
    p["display_name"] = json!("가".repeat(64));
    server
        .post("/api/auth/signup")
        .json(&p)
        .await
        .assert_status(StatusCode::CREATED);
}

#[sqlx::test(migrations = "./migrations")]
async fn signup_rejects_malformed_body(pool: sqlx::PgPool) {
    let server = common::test_server(pool).await;
    let bad = StatusCode::BAD_REQUEST;

    let res = server
        .post("/api/auth/signup")
        .content_type("application/json")
        .text("{not json")
        .await;
    common::assert_error(&res, bad, "request.invalidBody");

    assert_signup_error(
        &server,
        json!({ "username": "mom" }),
        bad,
        "request.invalidBody",
    )
    .await;
}
