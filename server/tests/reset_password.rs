mod common;

use std::process::Command;

use axum::http::StatusCode;
use common::{PASSWORD, assert_error};
use littledays::{
    auth::password,
    users::{self, NewUser, Role, reset},
};
use serde_json::json;
use sqlx::PgPool;

async fn create_user(pool: &PgPool, username: &str) {
    users::queries::create(
        pool,
        NewUser {
            username: username.to_string(),
            password_hash: password::hash(PASSWORD).expect("hash"),
            display_name: username.to_string(),
            role: Role::Owner,
            email: None,
            locale: "ko".to_string(),
        },
    )
    .await
    .expect("user");
}

#[sqlx::test(migrations = "./migrations")]
async fn resets_and_revokes_sessions(pool: PgPool) {
    create_user(&pool, "mom").await;
    let first = common::test_server(pool.clone()).await;
    let second = common::test_server(pool.clone()).await;
    for server in [&first, &second] {
        server
            .post("/api/auth/login")
            .json(&json!({ "username": "mom", "password": PASSWORD }))
            .await
            .assert_status_ok();
    }

    let new_password = reset::reset_password(&pool, "MOM")
        .await
        .expect("reset")
        .expect("user exists");

    let fresh = common::test_server(pool.clone()).await;
    fresh
        .post("/api/auth/login")
        .json(&json!({ "username": "mom", "password": new_password }))
        .await
        .assert_status_ok();
    let res = fresh
        .post("/api/auth/login")
        .json(&json!({ "username": "mom", "password": PASSWORD }))
        .await;
    assert_error(&res, StatusCode::UNAUTHORIZED, "auth.invalidCredentials");
    for server in [&first, &second] {
        server
            .get("/api/auth/me")
            .await
            .assert_status(StatusCode::UNAUTHORIZED);
    }
}

#[sqlx::test(migrations = "./migrations")]
async fn unknown_user_is_none(pool: PgPool) {
    let result = reset::reset_password(&pool, "nobody").await.expect("reset");
    assert!(result.is_none());
}

#[sqlx::test(migrations = "./migrations")]
async fn password_is_20_alnum(pool: PgPool) {
    create_user(&pool, "mom").await;
    let new_password = reset::reset_password(&pool, "mom")
        .await
        .expect("reset")
        .expect("user exists");
    assert_eq!(new_password.len(), 20);
    assert!(new_password.bytes().all(|b| b.is_ascii_alphanumeric()));
}

/// 실제 바이너리를 `DATABASE_URL` 만 준 상태로 실행.
#[sqlx::test(migrations = "./migrations")]
async fn database_url_only(pool: PgPool) {
    create_user(&pool, "mom").await;
    let base = std::env::var("DATABASE_URL").expect("DATABASE_URL");
    let (server_part, _) = base.rsplit_once('/').expect("database name");
    let url = format!(
        "{server_part}/{}",
        pool.connect_options().get_database().expect("db name")
    );

    // .env 탐색 차단용 빈 작업 디렉터리.
    let cwd = tempfile::tempdir().expect("tempdir");
    let run = |args: &[&str]| {
        Command::new(env!("CARGO_BIN_EXE_littledays"))
            .args(args)
            .env_clear()
            .env("DATABASE_URL", &url)
            .env("PATH", std::env::var_os("PATH").unwrap_or_default())
            .current_dir(cwd.path())
            .output()
            .expect("run binary")
    };

    let out = run(&["migrate"]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );

    let out = run(&["reset-password", "mom"]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let stdout = String::from_utf8(out.stdout).expect("utf8");
    let line = stdout.strip_suffix('\n').expect("trailing newline");
    assert_eq!(line.len(), 20, "{stdout:?}");
    assert!(line.bytes().all(|b| b.is_ascii_alphanumeric()));

    let out = run(&["reset-password", "nobody"]);
    assert_eq!(out.status.code(), Some(1));
}
