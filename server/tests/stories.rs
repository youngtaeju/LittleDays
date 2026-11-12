mod common;

use axum::http::StatusCode;
use axum_test::{TestResponse, TestServer};
use chrono::{Duration, NaiveDate, Utc};
use common::{AssetSeed, XRW, XRW_VALUE, assert_error, insert_asset, media_app};
use littledays::{
    app::build_router,
    babies::{self, BabyInput},
    settings,
    users::Role,
};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

async fn baby(pool: &PgPool, name: &str) -> Uuid {
    babies::queries::create(
        pool,
        BabyInput {
            name: name.to_string(),
            birth_date: "2024-01-01".parse().unwrap(),
            sex: None,
        },
    )
    .await
    .expect("baby")
    .id
}

async fn photo(pool: &PgPool, by: Uuid) -> Uuid {
    insert_asset(pool, AssetSeed::photo(by)).await
}

async fn today(pool: &PgPool) -> NaiveDate {
    let tz = settings::queries::load(pool).await.unwrap().timezone;
    sqlx::query_scalar!(r#"SELECT (now() AT TIME ZONE $1)::date AS "d!""#, tz)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn post(server: &TestServer, body: Value) -> TestResponse {
    server
        .post("/api/stories")
        .add_header(XRW, XRW_VALUE)
        .json(&body)
        .await
}

/// 날짜 2024-06-01, 아기 없음, 사진 없음 기본값에 `extra` 덮어씀.
async fn create(server: &TestServer, extra: Value) -> Value {
    let mut body = json!({
        "entry_date": "2024-06-01",
        "body": "오늘의 이야기",
        "baby_ids": [],
        "asset_ids": [],
    });
    for (k, v) in extra.as_object().unwrap() {
        body[k] = v.clone();
    }
    let res = post(server, body).await;
    res.assert_status(StatusCode::CREATED);
    res.json()
}

async fn patch(server: &TestServer, id: &str, body: Value) -> TestResponse {
    server
        .patch(&format!("/api/stories/{id}"))
        .add_header(XRW, XRW_VALUE)
        .json(&body)
        .await
}

async fn delete(server: &TestServer, id: &str) -> TestResponse {
    server
        .delete(&format!("/api/stories/{id}"))
        .add_header(XRW, XRW_VALUE)
        .await
}

async fn get(server: &TestServer, id: &str) -> Value {
    let res = server.get(&format!("/api/stories/{id}")).await;
    res.assert_status_ok();
    res.json()
}

async fn trash(server: &TestServer, asset: Uuid) {
    server
        .delete(&format!("/api/assets/{asset}"))
        .add_header(XRW, XRW_VALUE)
        .await
        .assert_status(StatusCode::NO_CONTENT);
}

fn ids(v: &Value) -> Vec<String> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|a| a["id"].as_str().unwrap().to_string())
        .collect()
}

fn strs(ids: &[Uuid]) -> Vec<String> {
    ids.iter().map(Uuid::to_string).collect()
}

#[sqlx::test]
async fn create_and_get(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let first = baby(&pool, "첫째").await;
    let second = baby(&pool, "둘째").await;
    let mut photos = Vec::new();
    for _ in 0..5 {
        photos.push(photo(&pool, app.user.id).await);
    }
    let mut order = photos.clone();
    order.reverse();
    let mut with_dup = order.clone();
    with_dup.push(order[0]);

    let s = create(
        &app.server,
        json!({
            "body": format!("  첫 산책 <@{}>\n ", app.user.id),
            "baby_ids": [second, first, second],
            "asset_ids": with_dup,
        }),
    )
    .await;
    assert_eq!(s["body"], format!("첫 산책 <@{}>", app.user.id));
    assert_eq!(s["author_id"], app.user.id.to_string());
    assert_eq!(s["entry_date"], "2024-06-01");
    assert!(s["edited_at"].is_null());
    assert_eq!(s["baby_ids"], json!(strs(&[first, second])));
    assert_eq!(ids(&s["assets"]), strs(&order));
    assert_eq!(ids(&s["previews"]), strs(&order[..4]));
    assert_eq!(s["asset_count"], 5);
    assert_eq!(s["like_count"], 0);
    assert_eq!(s["comment_count"], 0);
    assert_eq!(s["liked"], false);

    let id = s["id"].as_str().unwrap();
    assert_eq!(get(&app.server, id).await, s);
    let (family, _) = app.login_as("aunt", Role::Family).await;
    assert_eq!(get(&family, id).await, s);

    let res = app
        .server
        .get(&format!("/api/stories/{}", Uuid::now_v7()))
        .await;
    assert_error(&res, StatusCode::NOT_FOUND, "story.notFound");
}

#[sqlx::test]
async fn text_only_and_unknown_baby(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let s = create(&app.server, json!({})).await;
    assert_eq!(s["assets"], json!([]));
    assert_eq!(s["previews"], json!([]));
    assert_eq!(s["baby_ids"], json!([]));
    assert_eq!(s["asset_count"], 0);

    let res = post(
        &app.server,
        json!({
            "entry_date": "2024-06-01", "body": "x",
            "baby_ids": [Uuid::now_v7()], "asset_ids": [],
        }),
    )
    .await;
    assert_error(&res, StatusCode::BAD_REQUEST, "asset.babyInvalid");
}

#[sqlx::test]
async fn family_cannot_write(pool: PgPool) {
    let app = media_app(&pool, Role::Family).await;
    let res = post(
        &app.server,
        json!({ "entry_date": "2024-06-01", "body": "x", "baby_ids": [], "asset_ids": [] }),
    )
    .await;
    assert_error(&res, StatusCode::FORBIDDEN, "story.forbidden");
}

#[sqlx::test]
async fn story_date_uses_instance_today(pool: PgPool) {
    settings::queries::set(&pool, "timezone", json!("Asia/Seoul"))
        .await
        .unwrap();
    let app = media_app(&pool, Role::Owner).await;
    let today = today(&pool).await;
    let s = create(&app.server, json!({ "entry_date": today })).await;
    assert_eq!(s["entry_date"], today.to_string());

    let tomorrow = today + Duration::days(1);
    let res = post(
        &app.server,
        json!({ "entry_date": tomorrow, "body": "x", "baby_ids": [], "asset_ids": [] }),
    )
    .await;
    assert_error(&res, StatusCode::BAD_REQUEST, "story.dateInvalid");
    let res = patch(
        &app.server,
        s["id"].as_str().unwrap(),
        json!({ "entry_date": tomorrow }),
    )
    .await;
    assert_error(&res, StatusCode::BAD_REQUEST, "story.dateInvalid");
}

#[sqlx::test]
async fn body_limits(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    create(&app.server, json!({ "body": "😀".repeat(5000) })).await;
    for bad in ["😀".repeat(5001), " \n ".to_string()] {
        let res = post(
            &app.server,
            json!({ "entry_date": "2024-06-01", "body": bad, "baby_ids": [], "asset_ids": [] }),
        )
        .await;
        assert_error(&res, StatusCode::BAD_REQUEST, "story.bodyInvalid");
    }
    let s = create(&app.server, json!({})).await;
    let res = patch(
        &app.server,
        s["id"].as_str().unwrap(),
        json!({ "body": " " }),
    )
    .await;
    assert_error(&res, StatusCode::BAD_REQUEST, "story.bodyInvalid");
}

#[sqlx::test]
async fn mention_must_be_user(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let res = post(
        &app.server,
        json!({
            "entry_date": "2024-06-01", "body": format!("<@{}>", Uuid::now_v7()),
            "baby_ids": [], "asset_ids": [],
        }),
    )
    .await;
    assert_error(&res, StatusCode::BAD_REQUEST, "comment.mentionInvalid");
    let s = create(&app.server, json!({})).await;
    let res = patch(
        &app.server,
        s["id"].as_str().unwrap(),
        json!({ "body": format!("<@{}>", Uuid::now_v7()) }),
    )
    .await;
    assert_error(&res, StatusCode::BAD_REQUEST, "comment.mentionInvalid");
}

#[sqlx::test]
async fn trashed_asset_rejected(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let mut seed = AssetSeed::photo(app.user.id);
    seed.deleted_at = Some(Utc::now());
    let trashed = insert_asset(&pool, seed).await;
    for bad in [trashed, Uuid::now_v7()] {
        let res = post(
            &app.server,
            json!({ "entry_date": "2024-06-01", "body": "x", "baby_ids": [], "asset_ids": [bad] }),
        )
        .await;
        assert_error(&res, StatusCode::NOT_FOUND, "asset.notFound");
    }
    let s = create(&app.server, json!({})).await;
    let res = patch(
        &app.server,
        s["id"].as_str().unwrap(),
        json!({ "asset_ids": [trashed] }),
    )
    .await;
    assert_error(&res, StatusCode::NOT_FOUND, "asset.notFound");
}

#[sqlx::test]
async fn patch_author_only(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let (other, _) = app.login_as("dad", Role::Guardian).await;
    let (owner, _) = app.login_as("grandma", Role::Owner).await;
    let a = baby(&pool, "첫째").await;
    let s = create(&app.server, json!({ "baby_ids": [a] })).await;
    let id = s["id"].as_str().unwrap();

    for server in [&other, &owner] {
        let res = patch(server, id, json!({ "body": "남이 고침" })).await;
        assert_error(&res, StatusCode::FORBIDDEN, "story.forbidden");
    }
    let res = patch(&app.server, &Uuid::now_v7().to_string(), json!({})).await;
    assert_error(&res, StatusCode::NOT_FOUND, "story.notFound");

    let res = patch(&app.server, id, json!({ "body": " 고침 " })).await;
    res.assert_status_ok();
    let edited: Value = res.json();
    assert_eq!(edited["body"], "고침");
    assert!(!edited["edited_at"].is_null());
    assert_eq!(edited["created_at"], s["created_at"]);
    assert_eq!(edited["entry_date"], s["entry_date"]);
    assert_eq!(edited["baby_ids"], s["baby_ids"]);

    let res = patch(
        &app.server,
        id,
        json!({ "entry_date": "2024-05-01", "baby_ids": [] }),
    )
    .await;
    res.assert_status_ok();
    let edited: Value = res.json();
    assert_eq!(edited["body"], "고침");
    assert_eq!(edited["entry_date"], "2024-05-01");
    assert_eq!(edited["baby_ids"], json!([]));
}

#[sqlx::test]
async fn patch_replaces_assets(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let p: Vec<Uuid> = {
        let mut v = Vec::new();
        for _ in 0..3 {
            v.push(photo(&pool, app.user.id).await);
        }
        v
    };
    let s = create(&app.server, json!({ "asset_ids": [p[0], p[1]] })).await;
    let id = s["id"].as_str().unwrap();

    let res = patch(&app.server, id, json!({ "asset_ids": [p[2], p[0]] })).await;
    res.assert_status_ok();
    let edited: Value = res.json();
    assert_eq!(ids(&edited["assets"]), strs(&[p[2], p[0]]));
    assert_eq!(edited["asset_count"], 2);

    let res = patch(&app.server, id, json!({ "body": "사진 그대로" })).await;
    res.assert_status_ok();
    assert_eq!(ids(&res.json::<Value>()["assets"]), strs(&[p[2], p[0]]));

    let res = patch(&app.server, id, json!({ "asset_ids": [] })).await;
    res.assert_status_ok();
    assert_eq!(res.json::<Value>()["assets"], json!([]));
}

#[sqlx::test]
async fn delete_matrix(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let (owner, _) = app.login_as("grandma", Role::Owner).await;
    let (guardian, _) = app.login_as("dad", Role::Guardian).await;
    let (family, _) = app.login_as("aunt", Role::Family).await;

    let s = create(&app.server, json!({})).await;
    let id = s["id"].as_str().unwrap();
    assert_error(
        &delete(&family, id).await,
        StatusCode::FORBIDDEN,
        "story.forbidden",
    );
    delete(&app.server, id)
        .await
        .assert_status(StatusCode::NO_CONTENT);
    assert_error(
        &delete(&app.server, id).await,
        StatusCode::NOT_FOUND,
        "story.notFound",
    );
    let res = app.server.get(&format!("/api/stories/{id}")).await;
    assert_error(&res, StatusCode::NOT_FOUND, "story.notFound");

    for server in [&owner, &guardian] {
        let s = create(&app.server, json!({})).await;
        delete(server, s["id"].as_str().unwrap())
            .await
            .assert_status(StatusCode::NO_CONTENT);
    }
}

#[sqlx::test]
async fn delete_keeps_assets(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let p = photo(&pool, app.user.id).await;
    let s = create(&app.server, json!({ "asset_ids": [p] })).await;
    delete(&app.server, s["id"].as_str().unwrap())
        .await
        .assert_status(StatusCode::NO_CONTENT);
    app.server
        .get(&format!("/api/assets/{p}"))
        .await
        .assert_status_ok();
    let links = sqlx::query_scalar!(
        r#"SELECT count(*) AS "n!" FROM story_assets WHERE asset_id = $1"#,
        p
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(links, 0);
}

#[sqlx::test]
async fn trashed_photo_hidden_then_restored(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let a = photo(&pool, app.user.id).await;
    let b = photo(&pool, app.user.id).await;
    let c = photo(&pool, app.user.id).await;
    let s = create(&app.server, json!({ "asset_ids": [a, b] })).await;
    let id = s["id"].as_str().unwrap();

    trash(&app.server, a).await;
    let hidden = get(&app.server, id).await;
    assert_eq!(ids(&hidden["assets"]), strs(&[b]));
    assert_eq!(ids(&hidden["previews"]), strs(&[b]));
    assert_eq!(hidden["asset_count"], 1);

    // 휴지통 사진 연결은 사진 목록 교체 뒤에도 유지.
    patch(&app.server, id, json!({ "asset_ids": [c, b] }))
        .await
        .assert_status_ok();

    app.server
        .post(&format!("/api/assets/{a}/restore"))
        .add_header(XRW, XRW_VALUE)
        .await
        .assert_status_ok();
    let restored = get(&app.server, id).await;
    let mut got = ids(&restored["assets"]);
    got.sort();
    let mut want = strs(&[a, b, c]);
    want.sort();
    assert_eq!(got, want);
    assert_eq!(restored["asset_count"], 3);
}

#[sqlx::test]
async fn permanent_delete_unlinks(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let a = photo(&pool, app.user.id).await;
    let b = photo(&pool, app.user.id).await;
    let s = create(&app.server, json!({ "asset_ids": [a, b] })).await;
    let id = s["id"].as_str().unwrap();

    trash(&app.server, a).await;
    app.server
        .delete(&format!("/api/assets/{a}/permanent"))
        .add_header(XRW, XRW_VALUE)
        .await
        .assert_status(StatusCode::NO_CONTENT);
    let after = get(&app.server, id).await;
    assert_eq!(ids(&after["assets"]), strs(&[b]));
    let links = sqlx::query_scalar!(
        r#"SELECT count(*) AS "n!" FROM story_assets WHERE asset_id = $1"#,
        a
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(links, 0);
}

#[sqlx::test]
async fn baby_delete_unlinks_tag(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let a = baby(&pool, "첫째").await;
    let b = baby(&pool, "둘째").await;
    let s = create(&app.server, json!({ "baby_ids": [a, b] })).await;
    app.server
        .delete(&format!("/api/babies/{a}"))
        .add_header(XRW, XRW_VALUE)
        .await
        .assert_status(StatusCode::NO_CONTENT);
    let after = get(&app.server, s["id"].as_str().unwrap()).await;
    assert_eq!(after["baby_ids"], json!(strs(&[b])));
}

#[sqlx::test]
async fn stories_require_auth(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let s = create(&app.server, json!({})).await;
    let id = s["id"].as_str().unwrap();
    let anon = TestServer::new(build_router(app.state.clone())).unwrap();
    anon.get(&format!("/api/stories/{id}"))
        .await
        .assert_status(StatusCode::UNAUTHORIZED);
    post(&anon, json!({}))
        .await
        .assert_status(StatusCode::UNAUTHORIZED);
    patch(&anon, id, json!({}))
        .await
        .assert_status(StatusCode::UNAUTHORIZED);
    delete(&anon, id)
        .await
        .assert_status(StatusCode::UNAUTHORIZED);
}
