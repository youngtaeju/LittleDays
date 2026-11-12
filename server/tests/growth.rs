mod common;

use axum::http::StatusCode;
use axum_test::{TestResponse, TestServer};
use chrono::{DateTime, Utc};
use common::{XRW, XRW_VALUE, assert_error, media_app};
use littledays::{
    babies::{self, BabyInput},
    settings,
    users::Role,
};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

async fn baby(pool: &PgPool, birth: &str) -> Uuid {
    babies::queries::create(
        pool,
        BabyInput {
            name: "하나".to_string(),
            birth_date: birth.parse().unwrap(),
            sex: None,
        },
    )
    .await
    .expect("baby")
    .id
}

async fn post(server: &TestServer, baby: Uuid, body: Value) -> TestResponse {
    server
        .post(&format!("/api/babies/{baby}/growth"))
        .add_header(XRW, XRW_VALUE)
        .json(&body)
        .await
}

async fn patch(server: &TestServer, id: &str, body: Value) -> TestResponse {
    server
        .patch(&format!("/api/growth/{id}"))
        .add_header(XRW, XRW_VALUE)
        .json(&body)
        .await
}

async fn list(server: &TestServer, baby: Uuid) -> Vec<Value> {
    let res = server.get(&format!("/api/babies/{baby}/growth")).await;
    res.assert_status_ok();
    res.json()
}

async fn today(pool: &PgPool) -> chrono::NaiveDate {
    let tz = settings::queries::load(pool).await.unwrap().timezone;
    sqlx::query_scalar!(r#"SELECT (now() AT TIME ZONE $1)::date AS "d!""#, tz)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[sqlx::test]
async fn create_list_order(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let b = baby(&pool, "2024-01-01").await;
    let other = baby(&pool, "2024-01-01").await;
    let res = post(
        &app.server,
        b,
        json!({"measured_on": "2024-03-01", "height_cm": 60.5, "weight_kg": 6.25, "note": "  검진 "}),
    )
    .await;
    res.assert_status(StatusCode::CREATED);
    let first: Value = res.json();
    assert_eq!(first["height_cm"], 60.5);
    assert_eq!(first["weight_kg"], 6.25);
    assert_eq!(first["note"], "검진");
    assert_eq!(first["created_by"], app.user.id.to_string());
    post(
        &app.server,
        b,
        json!({"measured_on": "2024-02-01", "weight_kg": 5.0}),
    )
    .await
    .assert_status(StatusCode::CREATED);
    let same_day = post(
        &app.server,
        b,
        json!({"measured_on": "2024-03-01", "height_cm": 61.0, "note": " "}),
    )
    .await;
    same_day.assert_status(StatusCode::CREATED);
    let same_day: Value = same_day.json();
    assert!(same_day["note"].is_null());
    post(
        &app.server,
        other,
        json!({"measured_on": "2024-02-01", "weight_kg": 4.0}),
    )
    .await
    .assert_status(StatusCode::CREATED);

    let rows = list(&app.server, b).await;
    assert_eq!(rows.len(), 3);
    assert_eq!(rows[0]["measured_on"], "2024-02-01");
    assert!(rows[0]["height_cm"].is_null());
    assert_eq!(rows[1]["id"], first["id"]);
    assert_eq!(rows[2]["id"], same_day["id"]);

    let res = app
        .server
        .get(&format!("/api/babies/{}/growth", Uuid::now_v7()))
        .await;
    assert_error(&res, StatusCode::NOT_FOUND, "babies.notFound");
}

#[sqlx::test]
async fn value_bounds(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let b = baby(&pool, "2024-01-01").await;
    for body in [
        json!({"height_cm": 20.0}),
        json!({"height_cm": 150.0}),
        json!({"weight_kg": 0.5}),
        json!({"weight_kg": 50.0}),
        json!({"weight_kg": 0.57}),
        json!({"weight_kg": 1.15}),
        json!({"weight_kg": 4.35}),
        json!({"height_cm": 76.2}),
    ] {
        let mut body = body;
        body["measured_on"] = json!("2024-03-01");
        post(&app.server, b, body.clone())
            .await
            .assert_status(StatusCode::CREATED);
    }
    for body in [
        json!({"height_cm": 150.1}),
        json!({"height_cm": 19.9}),
        json!({"height_cm": 76.25}),
        json!({"weight_kg": 0.49}),
        json!({"weight_kg": 50.01}),
        json!({"weight_kg": 4.355}),
        json!({}),
        json!({"height_cm": null, "weight_kg": null}),
    ] {
        let mut body = body;
        body["measured_on"] = json!("2024-03-01");
        let res = post(&app.server, b, body.clone()).await;
        assert_error(&res, StatusCode::BAD_REQUEST, "growth.valueInvalid");
    }
    let res = post(
        &app.server,
        b,
        json!({"measured_on": "2024-03-01", "height_cm": 60.0, "note": "가".repeat(101)}),
    )
    .await;
    assert_error(&res, StatusCode::BAD_REQUEST, "growth.noteInvalid");
    let rows = list(&app.server, b).await;
    assert_eq!(rows.len(), 8);
    // numeric 저장 후 float8 변환 값 그대로
    let weights: Vec<f64> = rows
        .iter()
        .filter_map(|r| r["weight_kg"].as_f64())
        .collect();
    assert_eq!(weights, [0.5, 50.0, 0.57, 1.15, 4.35]);
    let heights: Vec<f64> = rows
        .iter()
        .filter_map(|r| r["height_cm"].as_f64())
        .collect();
    assert_eq!(heights, [20.0, 150.0, 76.2]);
}

#[sqlx::test]
async fn date_bounds(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let b = baby(&pool, "2024-01-01").await;
    let ok = post(
        &app.server,
        b,
        json!({"measured_on": "2024-01-01", "height_cm": 50.0}),
    )
    .await;
    ok.assert_status(StatusCode::CREATED);
    let res = post(
        &app.server,
        b,
        json!({"measured_on": "2023-12-31", "height_cm": 50.0}),
    )
    .await;
    assert_error(&res, StatusCode::BAD_REQUEST, "growth.dateInvalid");
    let today = today(&pool).await;
    post(
        &app.server,
        b,
        json!({"measured_on": today, "height_cm": 80.0}),
    )
    .await
    .assert_status(StatusCode::CREATED);
    let tomorrow = today.succ_opt().unwrap();
    let res = post(
        &app.server,
        b,
        json!({"measured_on": tomorrow, "height_cm": 80.0}),
    )
    .await;
    assert_error(&res, StatusCode::BAD_REQUEST, "growth.dateInvalid");

    let id = ok.json::<Value>()["id"].as_str().unwrap().to_string();
    let res = patch(&app.server, &id, json!({"measured_on": "2023-12-31"})).await;
    assert_error(&res, StatusCode::BAD_REQUEST, "growth.dateInvalid");
    let res = patch(&app.server, &id, json!({"measured_on": tomorrow})).await;
    assert_error(&res, StatusCode::BAD_REQUEST, "growth.dateInvalid");
}

#[sqlx::test]
async fn family_read_only(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let (family, _) = app.login_as("aunt", Role::Family).await;
    let b = baby(&pool, "2024-01-01").await;
    let rec: Value = post(
        &app.server,
        b,
        json!({"measured_on": "2024-03-01", "height_cm": 60.0}),
    )
    .await
    .json();
    let id = rec["id"].as_str().unwrap();

    assert_eq!(list(&family, b).await.len(), 1);
    let res = post(
        &family,
        b,
        json!({"measured_on": "2024-03-01", "height_cm": 60.0}),
    )
    .await;
    assert_error(&res, StatusCode::FORBIDDEN, "auth.forbidden");
    let res = patch(&family, id, json!({"note": "x"})).await;
    assert_error(&res, StatusCode::FORBIDDEN, "auth.forbidden");
    let res = family
        .delete(&format!("/api/growth/{id}"))
        .add_header(XRW, XRW_VALUE)
        .await;
    assert_error(&res, StatusCode::FORBIDDEN, "auth.forbidden");
    assert_eq!(list(&app.server, b).await.len(), 1);
}

#[sqlx::test]
async fn guardian_edits_others(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let (guardian, _) = app.login_as("dad", Role::Guardian).await;
    let b = baby(&pool, "2024-01-01").await;
    let rec: Value = post(
        &app.server,
        b,
        json!({"measured_on": "2024-03-01", "height_cm": 60.0, "weight_kg": 6.0, "note": "처음"}),
    )
    .await
    .json();
    let id = rec["id"].as_str().unwrap();

    let res = patch(
        &guardian,
        id,
        json!({"weight_kg": null, "note": null, "measured_on": "2024-03-02"}),
    )
    .await;
    res.assert_status_ok();
    let edited: Value = res.json();
    assert!(edited["weight_kg"].is_null());
    assert!(edited["note"].is_null());
    assert_eq!(edited["height_cm"], 60.0);
    assert_eq!(edited["measured_on"], "2024-03-02");
    assert_eq!(edited["created_by"], app.user.id.to_string());
    let ts = |v: &Value| v.as_str().unwrap().parse::<DateTime<Utc>>().unwrap();
    assert!(ts(&edited["updated_at"]) > ts(&rec["updated_at"]));

    let res = patch(&guardian, id, json!({"height_cm": 61.5})).await;
    res.assert_status_ok();
    assert_eq!(res.json::<Value>()["height_cm"], 61.5);
    let res = patch(&guardian, id, json!({"height_cm": 61.55})).await;
    assert_error(&res, StatusCode::BAD_REQUEST, "growth.valueInvalid");
    let res = patch(&guardian, &Uuid::now_v7().to_string(), json!({"note": "x"})).await;
    assert_error(&res, StatusCode::NOT_FOUND, "growth.notFound");

    guardian
        .delete(&format!("/api/growth/{id}"))
        .add_header(XRW, XRW_VALUE)
        .await
        .assert_status(StatusCode::NO_CONTENT);
    assert!(list(&app.server, b).await.is_empty());
    let res = guardian
        .delete(&format!("/api/growth/{id}"))
        .add_header(XRW, XRW_VALUE)
        .await;
    assert_error(&res, StatusCode::NOT_FOUND, "growth.notFound");
}

#[sqlx::test]
async fn patch_cannot_clear_both(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let b = baby(&pool, "2024-01-01").await;
    let rec: Value = post(
        &app.server,
        b,
        json!({"measured_on": "2024-03-01", "height_cm": 60.0, "weight_kg": 6.0}),
    )
    .await
    .json();
    let id = rec["id"].as_str().unwrap();
    patch(&app.server, id, json!({"height_cm": null}))
        .await
        .assert_status_ok();
    let res = patch(&app.server, id, json!({"weight_kg": null})).await;
    assert_error(&res, StatusCode::BAD_REQUEST, "growth.valueInvalid");
    let rows = list(&app.server, b).await;
    assert_eq!(rows[0]["weight_kg"], 6.0);
}

#[sqlx::test]
async fn baby_delete_cascades(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let b = baby(&pool, "2024-01-01").await;
    post(
        &app.server,
        b,
        json!({"measured_on": "2024-03-01", "height_cm": 60.0}),
    )
    .await
    .assert_status(StatusCode::CREATED);
    app.server
        .delete(&format!("/api/babies/{b}"))
        .add_header(XRW, XRW_VALUE)
        .await
        .assert_status(StatusCode::NO_CONTENT);
    let n = sqlx::query_scalar!(r#"SELECT count(*) AS "n!" FROM growth_records"#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 0);
}
