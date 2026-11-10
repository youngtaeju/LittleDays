mod common;

use axum::http::StatusCode;
use axum_test::{TestResponse, TestServer};
use chrono::Utc;
use common::{AssetSeed, XRW, XRW_VALUE, assert_error, insert_asset, media_app};
use littledays::users::Role;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

async fn create(server: &TestServer, body: Value) -> TestResponse {
    server
        .post("/api/babies")
        .add_header(XRW, XRW_VALUE)
        .json(&body)
        .await
}

async fn create_named(server: &TestServer, name: &str) -> Uuid {
    let res = create(server, json!({ "name": name, "birth_date": "2026-01-15" })).await;
    res.assert_status(StatusCode::CREATED);
    res.json::<Value>()["id"].as_str().unwrap().parse().unwrap()
}

async fn put(server: &TestServer, id: Uuid, body: Value) -> TestResponse {
    server
        .put(&format!("/api/babies/{id}"))
        .add_header(XRW, XRW_VALUE)
        .json(&body)
        .await
}

async fn put_order(server: &TestServer, ids: &[Uuid]) -> TestResponse {
    server
        .put("/api/babies/order")
        .add_header(XRW, XRW_VALUE)
        .json(&json!({ "ids": ids }))
        .await
}

async fn list_names(server: &TestServer) -> Vec<String> {
    let res = server.get("/api/babies").await;
    res.assert_status_ok();
    res.json::<Vec<Value>>()
        .iter()
        .map(|b| b["name"].as_str().unwrap().to_string())
        .collect()
}

fn replace_body(avatar: Option<Uuid>) -> Value {
    json!({
        "name": "하늘",
        "birth_date": "2026-01-15",
        "sex": null,
        "avatar_asset_id": avatar,
    })
}

#[sqlx::test(migrations = "./migrations")]
async fn family_cannot_create(pool: PgPool) {
    let app = media_app(&pool, Role::Family).await;
    let res = create(
        &app.server,
        json!({ "name": "하늘", "birth_date": "2026-01-15" }),
    )
    .await;
    assert_error(&res, StatusCode::FORBIDDEN, "auth.forbidden");
}

#[sqlx::test(migrations = "./migrations")]
async fn family_cannot_modify(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let id = create_named(&app.server, "하늘").await;
    let (family, _) = app.login_as("dad", Role::Family).await;

    let res = put(&family, id, replace_body(None)).await;
    assert_error(&res, StatusCode::FORBIDDEN, "auth.forbidden");
    let res = family
        .delete(&format!("/api/babies/{id}"))
        .add_header(XRW, XRW_VALUE)
        .await;
    assert_error(&res, StatusCode::FORBIDDEN, "auth.forbidden");
    let res = put_order(&family, &[id]).await;
    assert_error(&res, StatusCode::FORBIDDEN, "auth.forbidden");
}

#[sqlx::test(migrations = "./migrations")]
async fn create_and_list_in_order(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let res = create(
        &app.server,
        json!({ "name": "하늘", "birth_date": "2026-01-15", "sex": "female" }),
    )
    .await;
    res.assert_status(StatusCode::CREATED);
    create_named(&app.server, "바다").await;

    let (family, _) = app.login_as("dad", Role::Family).await;
    let res = family.get("/api/babies").await;
    res.assert_status_ok();
    let babies = res.json::<Vec<Value>>();
    assert_eq!(babies.len(), 2);
    assert_eq!(babies[0]["name"], "하늘");
    assert_eq!(babies[0]["sort_order"], 0);
    assert_eq!(babies[0]["sex"], "female");
    assert_eq!(babies[0]["birth_date"], "2026-01-15");
    assert_eq!(babies[0]["avatar_asset_id"], Value::Null);
    assert_eq!(babies[1]["name"], "바다");
    assert_eq!(babies[1]["sort_order"], 1);
    assert_eq!(babies[1]["sex"], Value::Null);
}

#[sqlx::test(migrations = "./migrations")]
async fn name_is_trimmed_and_validated(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let res = create(
        &app.server,
        json!({ "name": "  하늘  ", "birth_date": "2026-01-15" }),
    )
    .await;
    res.assert_status(StatusCode::CREATED);
    assert_eq!(res.json::<Value>()["name"], "하늘");

    let res = create(
        &app.server,
        json!({ "name": "   ", "birth_date": "2026-01-15" }),
    )
    .await;
    assert_error(&res, StatusCode::BAD_REQUEST, "babies.nameInvalid");
}

#[sqlx::test(migrations = "./migrations")]
async fn put_replaces_and_validates_avatar(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let res = create(
        &app.server,
        json!({ "name": "별", "birth_date": "2026-01-15", "sex": "male" }),
    )
    .await;
    let id: Uuid = res.json::<Value>()["id"].as_str().unwrap().parse().unwrap();

    let res = put(&app.server, id, replace_body(Some(Uuid::now_v7()))).await;
    assert_error(&res, StatusCode::BAD_REQUEST, "babies.avatarInvalid");

    let mut processing = AssetSeed::photo(app.user.id);
    processing.status = "processing";
    let processing = insert_asset(&pool, processing).await;
    let res = put(&app.server, id, replace_body(Some(processing))).await;
    assert_error(&res, StatusCode::BAD_REQUEST, "babies.avatarInvalid");

    let mut trashed = AssetSeed::photo(app.user.id);
    trashed.deleted_at = Some(Utc::now());
    let trashed = insert_asset(&pool, trashed).await;
    let res = put(&app.server, id, replace_body(Some(trashed))).await;
    assert_error(&res, StatusCode::BAD_REQUEST, "babies.avatarInvalid");

    let mut video = AssetSeed::photo(app.user.id);
    video.kind = "video";
    let video = insert_asset(&pool, video).await;
    let res = put(&app.server, id, replace_body(Some(video))).await;
    assert_error(&res, StatusCode::BAD_REQUEST, "babies.avatarInvalid");

    let ready = insert_asset(&pool, AssetSeed::photo(app.user.id)).await;
    let res = put(&app.server, id, replace_body(Some(ready))).await;
    res.assert_status_ok();
    let body = res.json::<Value>();
    assert_eq!(body["avatar_asset_id"], ready.to_string());
    assert_eq!(body["name"], "하늘");
    assert_eq!(body["sex"], Value::Null);

    let res = put(&app.server, id, replace_body(None)).await;
    res.assert_status_ok();
    assert_eq!(res.json::<Value>()["avatar_asset_id"], Value::Null);
}

#[sqlx::test(migrations = "./migrations")]
async fn delete_cascades_tags(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let id = create_named(&app.server, "하늘").await;
    let asset = insert_asset(&pool, AssetSeed::photo(app.user.id)).await;
    sqlx::query!(
        "INSERT INTO asset_babies (asset_id, baby_id, tagged_by) VALUES ($1, $2, $3)",
        asset,
        id,
        app.user.id
    )
    .execute(&pool)
    .await
    .unwrap();

    let res = app
        .server
        .delete(&format!("/api/babies/{id}"))
        .add_header(XRW, XRW_VALUE)
        .await;
    res.assert_status(StatusCode::NO_CONTENT);

    let n = sqlx::query_scalar!(r#"SELECT count(*) AS "n!" FROM asset_babies"#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 0);
    assert!(list_names(&app.server).await.is_empty());
}

#[sqlx::test(migrations = "./migrations")]
async fn reorder(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let a = create_named(&app.server, "가").await;
    let b = create_named(&app.server, "나").await;
    let c = create_named(&app.server, "다").await;

    let res = put_order(&app.server, &[c, a, b]).await;
    res.assert_status(StatusCode::NO_CONTENT);
    assert_eq!(list_names(&app.server).await, ["다", "가", "나"]);

    let res = put_order(&app.server, &[c, a]).await;
    assert_error(&res, StatusCode::BAD_REQUEST, "babies.orderMismatch");
    let res = put_order(&app.server, &[c, a, a]).await;
    assert_error(&res, StatusCode::BAD_REQUEST, "babies.orderMismatch");
    let res = put_order(&app.server, &[c, a, Uuid::now_v7()]).await;
    assert_error(&res, StatusCode::BAD_REQUEST, "babies.orderMismatch");
    assert_eq!(list_names(&app.server).await, ["다", "가", "나"]);
}

#[sqlx::test(migrations = "./migrations")]
async fn unknown_baby_404(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let id = Uuid::now_v7();
    let res = put(&app.server, id, replace_body(None)).await;
    assert_error(&res, StatusCode::NOT_FOUND, "babies.notFound");
    let res = app
        .server
        .delete(&format!("/api/babies/{id}"))
        .add_header(XRW, XRW_VALUE)
        .await;
    assert_error(&res, StatusCode::NOT_FOUND, "babies.notFound");
}

async fn baby_born(pool: &PgPool, birth: &str) -> Uuid {
    sqlx::query_scalar!(
        "INSERT INTO babies (id, name, birth_date, sort_order) VALUES ($1, 'b', $2, 0) RETURNING id",
        Uuid::now_v7(),
        birth.parse::<chrono::NaiveDate>().unwrap(),
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

/// UTC 정오 `date` 에 아기 태그된 자산.
async fn tagged(pool: &PgPool, by: Uuid, baby: Uuid, date: &str, kind: &'static str) -> Uuid {
    let mut s = AssetSeed::photo(by);
    s.kind = kind;
    s.taken_at = format!("{date}T12:00:00Z").parse().unwrap();
    let id = insert_asset(pool, s).await;
    littledays::assets::queries::add_babies(pool, id, &[baby], by)
        .await
        .unwrap();
    id
}

async fn stats(app: &common::MediaApp, baby: Uuid) -> Value {
    let res = app.server.get(&format!("/api/babies/{baby}/stats")).await;
    res.assert_status_ok();
    res.json()
}

async fn utc(pool: &PgPool) {
    littledays::settings::queries::set(pool, "timezone", json!("UTC"))
        .await
        .unwrap();
}

/// `(age_month, from, to)` 목록.
fn buckets(v: &Value) -> Vec<(i64, Option<String>, String)> {
    v["age_months"]
        .as_array()
        .unwrap()
        .iter()
        .map(|b| {
            (
                b["age_month"].as_i64().unwrap(),
                b["from"].as_str().map(String::from),
                b["to"].as_str().unwrap().to_string(),
            )
        })
        .collect()
}

fn ages(v: &Value) -> Vec<i64> {
    buckets(v).into_iter().map(|b| b.0).collect()
}

#[sqlx::test(migrations = "./migrations")]
async fn stats_counts(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    utc(&pool).await;
    let b = baby_born(&pool, "2025-09-26").await;
    let other = baby_born(&pool, "2025-09-26").await;
    tagged(&pool, app.user.id, b, "2025-10-01", "photo").await;
    tagged(&pool, app.user.id, b, "2025-10-01", "photo").await;
    tagged(&pool, app.user.id, b, "2025-10-02", "video").await;
    tagged(&pool, app.user.id, other, "2025-10-03", "photo").await;
    let mut s = AssetSeed::photo(app.user.id);
    s.taken_at = "2025-10-04T12:00:00Z".parse().unwrap();
    s.deleted_at = Some(Utc::now());
    let trashed = insert_asset(&pool, s).await;
    littledays::assets::queries::add_babies(&pool, trashed, &[b], app.user.id)
        .await
        .unwrap();

    let v = stats(&app, b).await;
    assert_eq!(v["photo_count"], 2);
    assert_eq!(v["video_count"], 1);
    assert_eq!(v["day_count"], 2);
    assert_eq!(v["age_months"][0]["count"], 3);
    assert!(v["age_months"][0]["cover"]["uploaded_by"].is_string());
}

#[sqlx::test(migrations = "./migrations")]
async fn age_month_buckets(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    utc(&pool).await;
    let b = baby_born(&pool, "2025-09-26").await;
    for d in ["2025-09-26", "2025-10-25", "2025-10-26", "2026-11-09"] {
        tagged(&pool, app.user.id, b, d, "photo").await;
    }
    let v = stats(&app, b).await;
    assert_eq!(
        buckets(&v),
        [
            (13, Some("2026-10-26".into()), "2026-11-25".into()),
            (1, Some("2025-10-26".into()), "2025-11-25".into()),
            (0, Some("2025-09-26".into()), "2025-10-25".into()),
        ]
    );
    assert_eq!(v["age_months"][2]["count"], 2);
}

#[sqlx::test(migrations = "./migrations")]
async fn before_birth_is_minus_one(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    utc(&pool).await;
    let b = baby_born(&pool, "2025-09-26").await;
    tagged(&pool, app.user.id, b, "2025-09-25", "photo").await;
    tagged(&pool, app.user.id, b, "2025-09-26", "photo").await;
    tagged(&pool, app.user.id, b, "2025-01-01", "photo").await;
    let v = stats(&app, b).await;
    assert_eq!(
        buckets(&v),
        [
            (0, Some("2025-09-26".into()), "2025-10-25".into()),
            (-1, None, "2025-09-25".into()),
        ]
    );
    assert_eq!(v["age_months"][1]["count"], 2);
}

#[sqlx::test(migrations = "./migrations")]
async fn month_end_birthday_buckets(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    utc(&pool).await;
    let b = baby_born(&pool, "2025-01-31").await;
    for d in [
        "2025-02-27",
        "2025-02-28",
        "2025-03-30",
        "2025-03-31",
        "2025-04-30",
    ] {
        tagged(&pool, app.user.id, b, d, "photo").await;
    }
    let v = stats(&app, b).await;
    assert_eq!(
        buckets(&v),
        [
            (3, Some("2025-04-30".into()), "2025-05-30".into()),
            (2, Some("2025-03-31".into()), "2025-04-29".into()),
            (1, Some("2025-02-28".into()), "2025-03-30".into()),
            (0, Some("2025-01-31".into()), "2025-02-27".into()),
        ]
    );
    assert_eq!(v["age_months"][2]["count"], 2);

    let leap = baby_born(&pool, "2024-02-29").await;
    tagged(&pool, app.user.id, leap, "2025-02-27", "photo").await;
    tagged(&pool, app.user.id, leap, "2025-02-28", "photo").await;
    assert_eq!(ages(&stats(&app, leap).await), [12, 11]);
}

#[sqlx::test(migrations = "./migrations")]
async fn age_month_uses_local_date(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    littledays::settings::queries::set(&pool, "timezone", json!("Asia/Seoul"))
        .await
        .unwrap();
    let b = baby_born(&pool, "2025-09-26").await;
    // UTC 10-25 16:00 = 서울 10-26 01:00 -> 1개월
    let mut s = AssetSeed::photo(app.user.id);
    s.taken_at = "2025-10-25T16:00:00Z".parse().unwrap();
    let id = insert_asset(&pool, s).await;
    littledays::assets::queries::add_babies(&pool, id, &[b], app.user.id)
        .await
        .unwrap();
    assert_eq!(ages(&stats(&app, b).await), [1]);
}

#[sqlx::test(migrations = "./migrations")]
async fn empty_months_absent(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    utc(&pool).await;
    let b = baby_born(&pool, "2025-09-26").await;
    tagged(&pool, app.user.id, b, "2025-09-30", "photo").await;
    tagged(&pool, app.user.id, b, "2026-03-30", "photo").await;
    assert_eq!(ages(&stats(&app, b).await), [6, 0]);
    let empty = baby_born(&pool, "2025-09-26").await;
    let v = stats(&app, empty).await;
    assert_eq!(v["photo_count"], 0);
    assert_eq!(v["age_months"].as_array().unwrap().len(), 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn cover_is_latest(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    utc(&pool).await;
    let b = baby_born(&pool, "2025-09-26").await;
    tagged(&pool, app.user.id, b, "2025-09-27", "photo").await;
    let newest = tagged(&pool, app.user.id, b, "2025-10-20", "photo").await;
    tagged(&pool, app.user.id, b, "2025-10-01", "photo").await;
    let v = stats(&app, b).await;
    assert_eq!(v["age_months"][0]["cover"]["id"], newest.to_string());
    assert_eq!(v["age_months"][0]["count"], 3);
}

#[sqlx::test(migrations = "./migrations")]
async fn stats_baby_not_found(pool: PgPool) {
    let app = media_app(&pool, Role::Family).await;
    let res = app
        .server
        .get(&format!("/api/babies/{}/stats", Uuid::now_v7()))
        .await;
    assert_error(&res, StatusCode::NOT_FOUND, "babies.notFound");
}
