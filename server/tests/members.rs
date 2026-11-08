mod common;

use axum::http::StatusCode;
use axum_test::{TestResponse, TestServer};
use common::{PASSWORD, XRW, XRW_VALUE, assert_error, server_as};
use littledays::users::{Role, User};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

async fn patch_user(server: &TestServer, id: &str, body: Value) -> TestResponse {
    server
        .patch(&format!("/api/users/{id}"))
        .add_header(XRW, XRW_VALUE)
        .json(&body)
        .await
}

async fn patch_me(server: &TestServer, body: Value) -> TestResponse {
    server
        .patch("/api/users/me")
        .add_header(XRW, XRW_VALUE)
        .json(&body)
        .await
}

async fn change_password(server: &TestServer, current: &str, new: &str) -> TestResponse {
    server
        .post("/api/users/me/password")
        .add_header(XRW, XRW_VALUE)
        .json(&json!({ "current_password": current, "new_password": new }))
        .await
}

async fn login(server: &TestServer, username: &str, password: &str) -> TestResponse {
    server
        .post("/api/auth/login")
        .json(&json!({ "username": username, "password": password }))
        .await
}

async fn session_count(pool: &PgPool, user_id: Uuid) -> i64 {
    sqlx::query_scalar!(
        r#"SELECT count(*) AS "n!" FROM sessions WHERE user_id = $1"#,
        user_id
    )
    .fetch_one(pool)
    .await
    .expect("count")
}

/// owner `mom`, family `dad` 각각 로그인한 서버.
async fn owner_and_family(pool: &PgPool) -> ((TestServer, User), (TestServer, User)) {
    let owner = server_as(pool, "mom", Role::Owner).await;
    let family = server_as(pool, "dad", Role::Family).await;
    (owner, family)
}

#[sqlx::test(migrations = "./migrations")]
async fn owner_lists_and_changes_role(pool: PgPool) {
    let ((owner, mom), (family, dad)) = owner_and_family(&pool).await;

    // DB 시계 보정 영향 배제. 생성 시각 명시.
    for (user, age) in [(&mom, "2 hours"), (&dad, "1 hour")] {
        sqlx::query("UPDATE users SET created_at = now() - $1::interval WHERE id = $2")
            .bind(age)
            .bind(user.id)
            .execute(&pool)
            .await
            .expect("set created_at");
    }

    // 목록은 모든 역할 허용. 생성 순.
    for server in [&owner, &family] {
        let res = server.get("/api/users").await;
        res.assert_status_ok();
        let users = res.json::<Value>()["users"]
            .as_array()
            .expect("users")
            .clone();
        let ids: Vec<&str> = users
            .iter()
            .map(|u| u["id"].as_str().expect("id"))
            .collect();
        assert_eq!(ids, [mom.id.to_string(), dad.id.to_string()]);
        for user in &users {
            assert!(user.get("password_hash").is_none());
        }
    }

    let res = patch_user(&owner, &dad.id.to_string(), json!({ "role": "guardian" })).await;
    res.assert_status_ok();
    let user = &res.json::<Value>()["user"];
    assert_eq!(user["id"], dad.id.to_string());
    assert_eq!(user["role"], "guardian");
    assert!(user.get("password_hash").is_none());

    // 변경된 역할은 대상의 기존 세션에도 즉시 반영.
    let me: Value = family.get("/api/auth/me").await.json();
    assert_eq!(me["user"]["role"], "guardian");
}

#[sqlx::test(migrations = "./migrations")]
async fn owner_cannot_edit_self_400(pool: PgPool) {
    let (owner, mom) = server_as(&pool, "mom", Role::Owner).await;
    for body in [json!({ "role": "family" }), json!({ "disabled": true })] {
        assert_error(
            &patch_user(&owner, &mom.id.to_string(), body).await,
            StatusCode::BAD_REQUEST,
            "users.cannotEditSelf",
        );
    }
    let me: Value = owner.get("/api/auth/me").await.json();
    assert_eq!(me["user"]["role"], "owner");
    assert_eq!(me["user"]["disabled_at"], Value::Null);
}

#[sqlx::test(migrations = "./migrations")]
async fn owner_role_not_assignable_400(pool: PgPool) {
    let ((owner, _), (_, dad)) = owner_and_family(&pool).await;
    assert_error(
        &patch_user(&owner, &dad.id.to_string(), json!({ "role": "owner" })).await,
        StatusCode::BAD_REQUEST,
        "users.roleNotAllowed",
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn unknown_or_malformed_user_id(pool: PgPool) {
    let (owner, _) = server_as(&pool, "mom", Role::Owner).await;
    let missing = Uuid::now_v7().to_string();
    for body in [
        json!({ "role": "guardian" }),
        json!({ "disabled": true }),
        json!({}),
    ] {
        assert_error(
            &patch_user(&owner, &missing, body).await,
            StatusCode::NOT_FOUND,
            "users.notFound",
        );
    }
    assert_error(
        &patch_user(&owner, "not-a-uuid", json!({ "role": "guardian" })).await,
        StatusCode::BAD_REQUEST,
        "request.invalidPath",
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn non_owner_cannot_patch_user_403(pool: PgPool) {
    let ((_, mom), (family, _)) = owner_and_family(&pool).await;
    let (guardian, _) = server_as(&pool, "aunt", Role::Guardian).await;
    for server in [&guardian, &family] {
        assert_error(
            &patch_user(server, &mom.id.to_string(), json!({ "disabled": true })).await,
            StatusCode::FORBIDDEN,
            "auth.forbidden",
        );
    }
}

#[sqlx::test(migrations = "./migrations")]
async fn disable_kills_sessions(pool: PgPool) {
    let ((owner, _), (family, dad)) = owner_and_family(&pool).await;
    family.get("/api/auth/me").await.assert_status_ok();

    let res = patch_user(&owner, &dad.id.to_string(), json!({ "disabled": true })).await;
    res.assert_status_ok();
    let first = res.json::<Value>()["user"]["disabled_at"].clone();
    assert!(first.is_string());
    assert_eq!(session_count(&pool, dad.id).await, 0);
    assert_error(
        &family.get("/api/auth/me").await,
        StatusCode::UNAUTHORIZED,
        "auth.required",
    );
    assert_error(
        &login(&family, "dad", PASSWORD).await,
        StatusCode::UNAUTHORIZED,
        "auth.disabled",
    );

    // 재비활성화 시 최초 시각 유지.
    let res = patch_user(&owner, &dad.id.to_string(), json!({ "disabled": true })).await;
    res.assert_status_ok();
    assert_eq!(res.json::<Value>()["user"]["disabled_at"], first);
}

#[sqlx::test(migrations = "./migrations")]
async fn reenable_clears_disabled_at(pool: PgPool) {
    let ((owner, _), (family, dad)) = owner_and_family(&pool).await;
    patch_user(&owner, &dad.id.to_string(), json!({ "disabled": true }))
        .await
        .assert_status_ok();

    let res = patch_user(&owner, &dad.id.to_string(), json!({ "disabled": false })).await;
    res.assert_status_ok();
    assert_eq!(res.json::<Value>()["user"]["disabled_at"], Value::Null);

    login(&family, "dad", PASSWORD).await.assert_status_ok();
    family.get("/api/auth/me").await.assert_status_ok();
}

#[sqlx::test(migrations = "./migrations")]
async fn patch_me_updates_profile(pool: PgPool) {
    // family 의 200 응답으로 `/api/users/{id}`(owner 전용) 아닌 본인 핸들러 도달 확인.
    let (server, dad) = server_as(&pool, "dad", Role::Family).await;
    let res = patch_me(
        &server,
        json!({ "display_name": "  아빠  ", "locale": "en", "email": "  dad@example.com " }),
    )
    .await;
    res.assert_status_ok();
    let user = &res.json::<Value>()["user"];
    assert_eq!(user["id"], dad.id.to_string());
    assert_eq!(user["display_name"], "아빠");
    assert_eq!(user["locale"], "en");
    assert_eq!(user["email"], "dad@example.com");
    assert_eq!(user["role"], "family");

    // 생략 필드는 유지.
    let res = patch_me(&server, json!({ "locale": "ko" })).await;
    res.assert_status_ok();
    let user = &res.json::<Value>()["user"];
    assert_eq!(user["display_name"], "아빠");
    assert_eq!(user["locale"], "ko");
    assert_eq!(user["email"], "dad@example.com");

    // 빈 이메일은 삭제.
    let res = patch_me(&server, json!({ "email": "" })).await;
    res.assert_status_ok();
    assert_eq!(res.json::<Value>()["user"]["email"], Value::Null);

    let me: Value = server.get("/api/auth/me").await.json();
    assert_eq!(me["user"]["email"], Value::Null);
    assert_eq!(me["user"]["display_name"], "아빠");
}

#[sqlx::test(migrations = "./migrations")]
async fn patch_me_validations(pool: PgPool) {
    let (server, _) = server_as(&pool, "dad", Role::Family).await;
    for (body, key) in [
        (json!({ "display_name": "   " }), "auth.displayNameInvalid"),
        (json!({ "locale": "ja" }), "users.invalidLocale"),
        (json!({ "email": "no-at-sign" }), "users.invalidEmail"),
        (
            json!({ "email": format!("{}@example.com", "a".repeat(243)) }),
            "users.invalidEmail",
        ),
        // 일부 필드 실패 시 전체 미반영.
        (
            json!({ "display_name": "아빠", "locale": "xx" }),
            "users.invalidLocale",
        ),
    ] {
        assert_error(&patch_me(&server, body).await, StatusCode::BAD_REQUEST, key);
    }
    let me: Value = server.get("/api/auth/me").await.json();
    assert_eq!(me["user"]["display_name"], "dad");
    assert_eq!(me["user"]["locale"], "ko");

    // 254자 경계는 허용.
    let email = format!("{}@example.com", "a".repeat(242));
    assert_eq!(email.len(), 254);
    patch_me(&server, json!({ "email": email }))
        .await
        .assert_status_ok();
}

#[sqlx::test(migrations = "./migrations")]
async fn patch_me_without_csrf_header_403(pool: PgPool) {
    let (server, _) = server_as(&pool, "dad", Role::Family).await;
    assert_error(
        &server
            .patch("/api/users/me")
            .json(&json!({ "locale": "en" }))
            .await,
        StatusCode::FORBIDDEN,
        "auth.csrf",
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn change_password_keeps_current_session(pool: PgPool) {
    let (current, mom) = server_as(&pool, "mom", Role::Owner).await;
    let other = common::test_server(pool.clone()).await;
    login(&other, "mom", PASSWORD).await.assert_status_ok();
    assert_eq!(session_count(&pool, mom.id).await, 2);

    let res = change_password(&current, PASSWORD, "new-password-1").await;
    res.assert_status(StatusCode::NO_CONTENT);

    current.get("/api/auth/me").await.assert_status_ok();
    assert_error(
        &other.get("/api/auth/me").await,
        StatusCode::UNAUTHORIZED,
        "auth.required",
    );
    assert_eq!(session_count(&pool, mom.id).await, 1);

    assert_error(
        &login(&other, "mom", PASSWORD).await,
        StatusCode::UNAUTHORIZED,
        "auth.invalidCredentials",
    );
    login(&other, "mom", "new-password-1")
        .await
        .assert_status_ok();
}

#[sqlx::test(migrations = "./migrations")]
async fn change_password_rejects_wrong_current_or_short_new(pool: PgPool) {
    let (server, mom) = server_as(&pool, "mom", Role::Owner).await;
    let other = common::test_server(pool.clone()).await;
    login(&other, "mom", PASSWORD).await.assert_status_ok();

    assert_error(
        &change_password(&server, "wrong-password", "new-password-1").await,
        StatusCode::UNAUTHORIZED,
        "auth.invalidCredentials",
    );
    assert_error(
        &change_password(&server, PASSWORD, "short").await,
        StatusCode::BAD_REQUEST,
        "auth.passwordTooShort",
    );

    // 실패 시 세션과 비밀번호 유지.
    assert_eq!(session_count(&pool, mom.id).await, 2);
    login(&other, "mom", PASSWORD).await.assert_status_ok();
}

#[sqlx::test(migrations = "./migrations")]
async fn user_endpoints_require_auth(pool: PgPool) {
    let server = common::test_server(pool).await;
    assert_error(
        &server.get("/api/users").await,
        StatusCode::UNAUTHORIZED,
        "auth.required",
    );
    assert_error(
        &patch_me(&server, json!({ "locale": "en" })).await,
        StatusCode::UNAUTHORIZED,
        "auth.required",
    );
    assert_error(
        &change_password(&server, PASSWORD, "new-password-1").await,
        StatusCode::UNAUTHORIZED,
        "auth.required",
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn email_hidden_from_non_owner(pool: PgPool) {
    let (owner, mom) = server_as(&pool, "mom", Role::Owner).await;
    let (guardian, dad) = server_as(&pool, "dad", Role::Guardian).await;
    let (_family, kid) = server_as(&pool, "kid", Role::Family).await;
    for (user, email) in [
        (&mom, "mom@x.test"),
        (&dad, "dad@x.test"),
        (&kid, "kid@x.test"),
    ] {
        sqlx::query("UPDATE users SET email = $1 WHERE id = $2")
            .bind(email)
            .bind(user.id)
            .execute(&pool)
            .await
            .expect("set email");
    }

    let emails = |res: TestResponse| -> Vec<(String, Value)> {
        res.json::<Value>()["users"]
            .as_array()
            .expect("users")
            .iter()
            .map(|u| {
                (
                    u["username"].as_str().expect("name").to_string(),
                    u["email"].clone(),
                )
            })
            .collect()
    };

    let seen = emails(guardian.get("/api/users").await);
    assert_eq!(seen.len(), 3);
    for (name, email) in seen {
        if name == "dad" {
            assert_eq!(email, "dad@x.test");
        } else {
            assert!(email.is_null(), "{name} email leaked");
        }
    }

    for (_, email) in emails(owner.get("/api/users").await) {
        assert!(email.is_string());
    }
}
