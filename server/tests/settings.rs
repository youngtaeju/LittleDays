mod common;

use axum::http::StatusCode;
use axum_test::{TestResponse, TestServer};
use common::{XRW, XRW_VALUE, assert_error, server_as, signup};
use littledays::{settings, users::Role};
use serde_json::{Value, json};
use sqlx::PgPool;

async fn patch_settings(server: &TestServer, body: Value) -> TestResponse {
    server
        .patch("/api/settings")
        .add_header(XRW, XRW_VALUE)
        .json(&body)
        .await
}

async fn get_settings(server: &TestServer) -> Value {
    let res = server.get("/api/settings").await;
    res.assert_status_ok();
    res.json()
}

#[sqlx::test(migrations = "./migrations")]
async fn defaults_then_patch(pool: PgPool) {
    // 직접 생성한 owner. 가입 경로의 instance_name 저장 없음.
    let (server, _) = server_as(&pool, "mom", Role::Owner).await;
    assert_eq!(
        get_settings(&server).await,
        json!({
            "instance_name": "LittleDays",
            "timezone": "Asia/Seoul",
            "default_locale": "ko",
            "derivatives_avif": false,
            "trash_retention_days": 0,
        })
    );

    let res = patch_settings(
        &server,
        json!({ "instance_name": "  우리집  ", "timezone": "Europe/Paris" }),
    )
    .await;
    res.assert_status_ok();
    let expected = json!({
        "instance_name": "우리집",
        "timezone": "Europe/Paris",
        "default_locale": "ko",
        "derivatives_avif": false,
        "trash_retention_days": 0,
    });
    res.assert_json(&expected);
    assert_eq!(get_settings(&server).await, expected);

    let res = patch_settings(
        &server,
        json!({ "default_locale": "en", "derivatives_avif": true }),
    )
    .await;
    res.assert_status_ok();
    res.assert_json(&json!({
        "instance_name": "우리집",
        "timezone": "Europe/Paris",
        "default_locale": "en",
        "derivatives_avif": true,
        "trash_retention_days": 0,
    }));
}

#[sqlx::test(migrations = "./migrations")]
async fn empty_patch_returns_current(pool: PgPool) {
    let (server, _) = server_as(&pool, "mom", Role::Owner).await;
    let res = patch_settings(&server, json!({})).await;
    res.assert_status_ok();
    res.assert_json(&get_settings(&server).await);
}

#[sqlx::test(migrations = "./migrations")]
async fn invalid_timezone_400(pool: PgPool) {
    let (server, _) = server_as(&pool, "mom", Role::Owner).await;
    for tz in ["Mars/Olympus", "", "asia/seoul"] {
        assert_error(
            &patch_settings(
                &server,
                json!({ "instance_name": "새 이름", "timezone": tz }),
            )
            .await,
            StatusCode::BAD_REQUEST,
            "settings.invalidTimezone",
        );
    }
    // 검증 실패 시 다른 필드도 미반영.
    assert_eq!(get_settings(&server).await["instance_name"], "LittleDays");
}

#[sqlx::test(migrations = "./migrations")]
async fn invalid_locale_400(pool: PgPool) {
    let (server, _) = server_as(&pool, "mom", Role::Owner).await;
    for locale in ["ja", "", "KO"] {
        assert_error(
            &patch_settings(&server, json!({ "default_locale": locale })).await,
            StatusCode::BAD_REQUEST,
            "settings.invalidLocale",
        );
    }
}

#[sqlx::test(migrations = "./migrations")]
async fn invalid_instance_name_400(pool: PgPool) {
    let (server, _) = server_as(&pool, "mom", Role::Owner).await;
    for name in ["   ".to_string(), "가".repeat(65)] {
        assert_error(
            &patch_settings(&server, json!({ "instance_name": name })).await,
            StatusCode::BAD_REQUEST,
            "settings.instanceNameInvalid",
        );
    }
    assert_error(
        &patch_settings(&server, json!({ "derivatives_avif": "yes" })).await,
        StatusCode::BAD_REQUEST,
        "request.invalidBody",
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn family_cannot_patch_403(pool: PgPool) {
    for (username, role) in [("dad", Role::Guardian), ("grandma", Role::Family)] {
        let (server, _) = server_as(&pool, username, role).await;
        // 조회는 모든 역할 허용.
        assert_eq!(get_settings(&server).await["instance_name"], "LittleDays");
        assert_error(
            &patch_settings(&server, json!({ "instance_name": "x" })).await,
            StatusCode::FORBIDDEN,
            "auth.forbidden",
        );
    }
}

#[sqlx::test(migrations = "./migrations")]
async fn settings_require_auth(pool: PgPool) {
    let server = common::test_server(pool).await;
    assert_error(
        &server.get("/api/settings").await,
        StatusCode::UNAUTHORIZED,
        "auth.required",
    );
    assert_error(
        &patch_settings(&server, json!({ "instance_name": "x" })).await,
        StatusCode::UNAUTHORIZED,
        "auth.required",
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn patch_without_csrf_header_403(pool: PgPool) {
    let (server, _) = server_as(&pool, "mom", Role::Owner).await;
    assert_error(
        &server
            .patch("/api/settings")
            .json(&json!({ "instance_name": "x" }))
            .await,
        StatusCode::FORBIDDEN,
        "auth.csrf",
    );
    assert_eq!(get_settings(&server).await["instance_name"], "LittleDays");
}

#[sqlx::test(migrations = "./migrations")]
async fn wrong_typed_stored_value_falls_back_to_default(pool: PgPool) {
    let (server, _) = server_as(&pool, "mom", Role::Owner).await;
    settings::queries::set(&pool, "instance_name", json!(42))
        .await
        .expect("set");
    settings::queries::set(&pool, "derivatives_avif", json!("true"))
        .await
        .expect("set");
    settings::queries::set(&pool, "timezone", json!("UTC"))
        .await
        .expect("set");
    assert_eq!(
        get_settings(&server).await,
        json!({
            "instance_name": "LittleDays",
            "timezone": "UTC",
            "default_locale": "ko",
            "derivatives_avif": false,
            "trash_retention_days": 0,
        })
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn invite_preview_shows_patched_instance_name(pool: PgPool) {
    let server = common::test_server(pool).await;
    signup(&server).await;
    patch_settings(&server, json!({ "instance_name": "새 이름" }))
        .await
        .assert_status_ok();

    let res = server
        .post("/api/invites")
        .add_header(XRW, XRW_VALUE)
        .json(&json!({ "role": "family" }))
        .await;
    res.assert_status(StatusCode::CREATED);
    let url = res.json::<Value>()["url"]
        .as_str()
        .expect("url")
        .to_string();
    let raw = url
        .strip_prefix("http://localhost/invite/")
        .expect("prefix");

    let res = server.get(&format!("/api/invites/{raw}/preview")).await;
    res.assert_status_ok();
    assert_eq!(res.json::<Value>()["instance_name"], "새 이름");
}

#[sqlx::test(migrations = "./migrations")]
async fn openapi_documents_settings_and_user_endpoints(pool: PgPool) {
    let server = common::test_server(pool).await;
    let doc: Value = server.get("/api/openapi.json").await.json();
    let paths = &doc["paths"];
    for (path, method, op) in [
        ("/api/settings", "get", "get_settings"),
        ("/api/settings", "patch", "patch_settings"),
        ("/api/users", "get", "list_users"),
        ("/api/users/{id}", "patch", "patch_user"),
        ("/api/users/me", "patch", "patch_me"),
        ("/api/users/me/password", "post", "change_password"),
    ] {
        assert_eq!(paths[path][method]["operationId"], op, "{method} {path}");
    }
    let error_ref = json!("#/components/schemas/ErrorBody");
    for (path, method, status) in [
        ("/api/settings", "patch", "400"),
        ("/api/users/{id}", "patch", "404"),
        ("/api/users/me/password", "post", "401"),
    ] {
        assert_eq!(
            paths[path][method]["responses"][status]["content"]["application/json"]["schema"]["$ref"],
            error_ref,
            "{method} {path} {status}"
        );
    }
    assert!(doc["components"]["schemas"]["Settings"].is_object());
}

#[sqlx::test(migrations = "./migrations")]
async fn trash_retention_days_roundtrip(pool: PgPool) {
    let (server, _) = server_as(&pool, "mom", Role::Owner).await;
    assert_eq!(get_settings(&server).await["trash_retention_days"], 0);

    let res = patch_settings(&server, json!({ "trash_retention_days": 30 })).await;
    res.assert_status_ok();
    assert_eq!(res.json::<Value>()["trash_retention_days"], 30);
    assert_eq!(get_settings(&server).await["trash_retention_days"], 30);

    let res = patch_settings(&server, json!({ "trash_retention_days": 3651 })).await;
    assert_error(
        &res,
        StatusCode::BAD_REQUEST,
        "settings.trashRetentionInvalid",
    );
}
