mod common;

use axum::http::StatusCode;
use axum_test::{TestResponse, TestServer};
use common::{AssetSeed, XRW, XRW_VALUE, assert_error, insert_asset, media_app};
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

async fn today(pool: &PgPool) -> chrono::NaiveDate {
    let tz = settings::queries::load(pool).await.unwrap().timezone;
    sqlx::query_scalar!(r#"SELECT (now() AT TIME ZONE $1)::date AS "d!""#, tz)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn post(server: &TestServer, baby: Uuid, body: Value) -> TestResponse {
    server
        .post(&format!("/api/babies/{baby}/milestones"))
        .add_header(XRW, XRW_VALUE)
        .json(&body)
        .await
}

/// `asset_ids` 생략 시 빈 목록.
async fn create(server: &TestServer, baby: Uuid, mut body: Value) -> Value {
    if body.get("asset_ids").is_none() {
        body["asset_ids"] = json!([]);
    }
    let res = post(server, baby, body).await;
    res.assert_status(StatusCode::CREATED);
    res.json()
}

async fn patch(server: &TestServer, id: &str, body: Value) -> TestResponse {
    server
        .patch(&format!("/api/milestones/{id}"))
        .add_header(XRW, XRW_VALUE)
        .json(&body)
        .await
}

async fn delete(server: &TestServer, id: &str) -> TestResponse {
    server
        .delete(&format!("/api/milestones/{id}"))
        .add_header(XRW, XRW_VALUE)
        .await
}

async fn get(server: &TestServer, id: &str) -> Value {
    let res = server.get(&format!("/api/milestones/{id}")).await;
    res.assert_status_ok();
    res.json()
}

async fn list(server: &TestServer, baby: Uuid) -> Vec<Value> {
    let res = server.get(&format!("/api/babies/{baby}/milestones")).await;
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

#[test]
fn preset_list_matches_spec() {
    let keys = littledays::milestones::presets::PRESET_KEYS;
    assert_eq!(keys.len(), 24);
    assert_eq!(keys[0], "first_smile");
    assert_eq!(keys[23], "first_daycare");
}

#[sqlx::test]
async fn preset_and_custom(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let b = baby(&pool, "2024-01-01").await;
    let a = insert_asset(&pool, AssetSeed::photo(app.user.id)).await;

    let preset = create(
        &app.server,
        b,
        json!({"preset_key": "rollover", "achieved_on": "2024-05-01", "note": "  드디어 ", "asset_ids": [a]}),
    )
    .await;
    assert_eq!(preset["preset_key"], "rollover");
    assert!(preset["custom_label"].is_null());
    assert_eq!(preset["note"], "드디어");
    assert_eq!(preset["baby_id"], b.to_string());
    assert_eq!(preset["created_by"], app.user.id.to_string());
    assert_eq!(preset["asset_count"], 1);
    assert_eq!(ids(&preset["assets"]), strs(&[a]));
    assert_eq!(ids(&preset["previews"]), strs(&[a]));

    let custom = create(
        &app.server,
        b,
        json!({"custom_label": " 첫 눈 ", "achieved_on": "2024-02-01"}),
    )
    .await;
    assert_eq!(custom["custom_label"], "첫 눈");
    assert!(custom["preset_key"].is_null());
    assert!(custom["note"].is_null());

    let rows = list(&app.server, b).await;
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["id"], custom["id"]);
    assert_eq!(rows[1]["id"], preset["id"]);
    assert!(rows[1].get("assets").is_none());
    assert_eq!(rows[1]["asset_count"], 1);

    let got = get(&app.server, preset["id"].as_str().unwrap()).await;
    assert_eq!(got["id"], preset["id"]);
    assert_eq!(ids(&got["assets"]), strs(&[a]));

    let res = app
        .server
        .get(&format!("/api/babies/{}/milestones", Uuid::now_v7()))
        .await;
    assert_error(&res, StatusCode::NOT_FOUND, "babies.notFound");
    let res = post(
        &app.server,
        Uuid::now_v7(),
        json!({"preset_key": "crawl", "achieved_on": "2024-05-01", "asset_ids": []}),
    )
    .await;
    assert_error(&res, StatusCode::NOT_FOUND, "babies.notFound");
    let res = app
        .server
        .get(&format!("/api/milestones/{}", Uuid::now_v7()))
        .await;
    assert_error(&res, StatusCode::NOT_FOUND, "milestone.notFound");
}

#[sqlx::test]
async fn preset_once_per_baby(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let b = baby(&pool, "2024-01-01").await;
    let other = baby(&pool, "2024-01-01").await;
    let body = json!({"preset_key": "crawl", "achieved_on": "2024-05-01", "asset_ids": []});
    post(&app.server, b, body.clone())
        .await
        .assert_status(StatusCode::CREATED);
    let res = post(&app.server, b, body.clone()).await;
    assert_error(&res, StatusCode::CONFLICT, "milestone.duplicate");
    post(&app.server, other, body)
        .await
        .assert_status(StatusCode::CREATED);
    for _ in 0..2 {
        post(
            &app.server,
            b,
            json!({"custom_label": "첫 눈", "achieved_on": "2024-05-01", "asset_ids": []}),
        )
        .await
        .assert_status(StatusCode::CREATED);
    }
    assert_eq!(list(&app.server, b).await.len(), 3);

    // 고치기로 만드는 중복도 409.
    let walk = create(
        &app.server,
        b,
        json!({"preset_key": "walk_alone", "achieved_on": "2024-06-01"}),
    )
    .await;
    let res = patch(
        &app.server,
        walk["id"].as_str().unwrap(),
        json!({"preset_key": "crawl"}),
    )
    .await;
    assert_error(&res, StatusCode::CONFLICT, "milestone.duplicate");
    assert_eq!(
        get(&app.server, walk["id"].as_str().unwrap()).await["preset_key"],
        "walk_alone"
    );
}

#[sqlx::test]
async fn label_rules(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let b = baby(&pool, "2024-01-01").await;
    let date = "2024-05-01";
    for body in [
        json!({"preset_key": "crawl", "custom_label": "x", "achieved_on": date}),
        json!({"achieved_on": date}),
        json!({"custom_label": "", "achieved_on": date}),
        json!({"custom_label": "   ", "achieved_on": date}),
        json!({"custom_label": "가".repeat(31), "achieved_on": date}),
    ] {
        let mut body = body;
        body["asset_ids"] = json!([]);
        let res = post(&app.server, b, body).await;
        assert_error(&res, StatusCode::BAD_REQUEST, "milestone.labelInvalid");
    }
    let res = post(
        &app.server,
        b,
        json!({"preset_key": "flying", "achieved_on": date, "asset_ids": []}),
    )
    .await;
    assert_error(&res, StatusCode::BAD_REQUEST, "milestone.presetInvalid");
    let res = post(
        &app.server,
        b,
        json!({"custom_label": "가".repeat(30), "achieved_on": date, "asset_ids": []}),
    )
    .await;
    res.assert_status(StatusCode::CREATED);
    let res = post(
        &app.server,
        b,
        json!({"custom_label": "ok", "achieved_on": date, "note": "가".repeat(101), "asset_ids": []}),
    )
    .await;
    assert_error(&res, StatusCode::BAD_REQUEST, "milestone.noteInvalid");
    let res = post(
        &app.server,
        b,
        json!({"custom_label": "ok2", "achieved_on": date, "note": "가".repeat(100), "asset_ids": []}),
    )
    .await;
    res.assert_status(StatusCode::CREATED);
    assert_eq!(list(&app.server, b).await.len(), 2);
}

#[sqlx::test]
async fn date_bounds(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let b = baby(&pool, "2024-01-01").await;
    let ok = create(
        &app.server,
        b,
        json!({"custom_label": "a", "achieved_on": "2024-01-01"}),
    )
    .await;
    let res = post(
        &app.server,
        b,
        json!({"custom_label": "b", "achieved_on": "2023-12-31", "asset_ids": []}),
    )
    .await;
    assert_error(&res, StatusCode::BAD_REQUEST, "milestone.dateInvalid");
    let today = today(&pool).await;
    create(
        &app.server,
        b,
        json!({"custom_label": "c", "achieved_on": today}),
    )
    .await;
    let tomorrow = today.succ_opt().unwrap();
    let res = post(
        &app.server,
        b,
        json!({"custom_label": "d", "achieved_on": tomorrow, "asset_ids": []}),
    )
    .await;
    assert_error(&res, StatusCode::BAD_REQUEST, "milestone.dateInvalid");

    let id = ok["id"].as_str().unwrap();
    let res = patch(&app.server, id, json!({"achieved_on": "2023-12-31"})).await;
    assert_error(&res, StatusCode::BAD_REQUEST, "milestone.dateInvalid");
    let res = patch(&app.server, id, json!({"achieved_on": tomorrow})).await;
    assert_error(&res, StatusCode::BAD_REQUEST, "milestone.dateInvalid");
}

#[sqlx::test]
async fn family_read_only(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let (family, _) = app.login_as("aunt", Role::Family).await;
    let (guardian, _) = app.login_as("dad", Role::Guardian).await;
    let b = baby(&pool, "2024-01-01").await;
    let m = create(
        &app.server,
        b,
        json!({"preset_key": "crawl", "achieved_on": "2024-05-01"}),
    )
    .await;
    let id = m["id"].as_str().unwrap();

    assert_eq!(list(&family, b).await.len(), 1);
    assert_eq!(get(&family, id).await["id"], m["id"]);
    let res = post(
        &family,
        b,
        json!({"custom_label": "x", "achieved_on": "2024-05-01", "asset_ids": []}),
    )
    .await;
    assert_error(&res, StatusCode::FORBIDDEN, "auth.forbidden");
    let res = patch(&family, id, json!({"note": "x"})).await;
    assert_error(&res, StatusCode::FORBIDDEN, "auth.forbidden");
    let res = delete(&family, id).await;
    assert_error(&res, StatusCode::FORBIDDEN, "auth.forbidden");

    // guardian 은 남이 쓴 것도 고치고 지움.
    let res = patch(&guardian, id, json!({"note": "고침"})).await;
    res.assert_status_ok();
    assert_eq!(res.json::<Value>()["created_by"], app.user.id.to_string());
    delete(&guardian, id)
        .await
        .assert_status(StatusCode::NO_CONTENT);
    assert!(list(&app.server, b).await.is_empty());
    let res = delete(&guardian, id).await;
    assert_error(&res, StatusCode::NOT_FOUND, "milestone.notFound");
}

#[sqlx::test]
async fn assets_follow_trash(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let b = baby(&pool, "2024-01-01").await;
    let p: Vec<Uuid> = {
        let mut v = Vec::new();
        for _ in 0..6 {
            v.push(insert_asset(&pool, AssetSeed::photo(app.user.id)).await);
        }
        v
    };
    // 중복은 한 번만, 목록 순서가 위치.
    let m = create(
        &app.server,
        b,
        json!({"custom_label": "여행", "achieved_on": "2024-05-01",
               "asset_ids": [p[2], p[0], p[2], p[1], p[3], p[4]]}),
    )
    .await;
    let id = m["id"].as_str().unwrap();
    assert_eq!(ids(&m["assets"]), strs(&[p[2], p[0], p[1], p[3], p[4]]));
    assert_eq!(ids(&m["previews"]), strs(&[p[2], p[0], p[1], p[3]]));
    assert_eq!(m["asset_count"], 5);

    trash(&app.server, p[0]).await;
    let hidden = get(&app.server, id).await;
    assert_eq!(ids(&hidden["assets"]), strs(&[p[2], p[1], p[3], p[4]]));
    assert_eq!(hidden["asset_count"], 4);
    assert_eq!(list(&app.server, b).await[0]["asset_count"], 4);

    // 휴지통 사진 연결은 교체 뒤에도 유지.
    patch(&app.server, id, json!({"asset_ids": [p[5], p[1]]}))
        .await
        .assert_status_ok();
    assert_eq!(
        ids(&get(&app.server, id).await["assets"]),
        strs(&[p[5], p[1]])
    );
    app.server
        .post(&format!("/api/assets/{}/restore", p[0]))
        .add_header(XRW, XRW_VALUE)
        .await
        .assert_status_ok();
    let restored = get(&app.server, id).await;
    assert_eq!(restored["asset_count"], 3);
    let mut got = ids(&restored["assets"]);
    got.sort();
    let mut want = strs(&[p[0], p[1], p[5]]);
    want.sort();
    assert_eq!(got, want);

    // 없는 사진, 휴지통 사진은 404.
    let res = patch(&app.server, id, json!({"asset_ids": [Uuid::now_v7()]})).await;
    assert_error(&res, StatusCode::NOT_FOUND, "asset.notFound");
    trash(&app.server, p[3]).await;
    let res = patch(&app.server, id, json!({"asset_ids": [p[3]]})).await;
    assert_error(&res, StatusCode::NOT_FOUND, "asset.notFound");
    let res = post(
        &app.server,
        b,
        json!({"custom_label": "x", "achieved_on": "2024-05-01", "asset_ids": [p[3]]}),
    )
    .await;
    assert_error(&res, StatusCode::NOT_FOUND, "asset.notFound");

    // 사진 완전 삭제는 연결만 지움.
    trash(&app.server, p[1]).await;
    app.server
        .delete(&format!("/api/assets/{}/permanent", p[1]))
        .add_header(XRW, XRW_VALUE)
        .await
        .assert_status(StatusCode::NO_CONTENT);
    let n = sqlx::query_scalar!(
        r#"SELECT count(*) AS "n!" FROM milestone_assets WHERE asset_id = $1"#,
        p[1]
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(n, 0);
}

#[sqlx::test]
async fn too_many_assets_rejected(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let b = baby(&pool, "2024-01-01").await;
    let ids: Vec<Uuid> = (0..201).map(|_| Uuid::now_v7()).collect();
    let res = post(
        &app.server,
        b,
        json!({"custom_label": "x", "achieved_on": "2024-05-01", "asset_ids": ids}),
    )
    .await;
    assert_error(&res, StatusCode::BAD_REQUEST, "request.invalidBody");
}

#[sqlx::test]
async fn patch_switch_to_custom(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let b = baby(&pool, "2024-01-01").await;
    let a = insert_asset(&pool, AssetSeed::photo(app.user.id)).await;
    let m = create(
        &app.server,
        b,
        json!({"preset_key": "crawl", "achieved_on": "2024-05-01", "note": "메모", "asset_ids": [a]}),
    )
    .await;
    let id = m["id"].as_str().unwrap();

    // 한쪽만 보내 둘 다 생기거나 둘 다 비면 400.
    let res = patch(&app.server, id, json!({"custom_label": "첫 눈"})).await;
    assert_error(&res, StatusCode::BAD_REQUEST, "milestone.labelInvalid");
    let res = patch(&app.server, id, json!({"preset_key": null})).await;
    assert_error(&res, StatusCode::BAD_REQUEST, "milestone.labelInvalid");
    let res = patch(&app.server, id, json!({"preset_key": "flying"})).await;
    assert_error(&res, StatusCode::BAD_REQUEST, "milestone.presetInvalid");
    assert_eq!(get(&app.server, id).await["preset_key"], "crawl");

    let res = patch(
        &app.server,
        id,
        json!({"preset_key": null, "custom_label": "첫 눈", "note": null, "achieved_on": "2024-06-01"}),
    )
    .await;
    res.assert_status_ok();
    let edited: Value = res.json();
    assert!(edited["preset_key"].is_null());
    assert_eq!(edited["custom_label"], "첫 눈");
    assert!(edited["note"].is_null());
    assert_eq!(edited["achieved_on"], "2024-06-01");
    assert_eq!(ids(&edited["assets"]), strs(&[a]));
    assert!(edited["updated_at"].as_str() > m["updated_at"].as_str());
    assert_eq!(edited["created_at"], m["created_at"]);

    let res = patch(
        &app.server,
        id,
        json!({"custom_label": null, "preset_key": "walk_alone"}),
    )
    .await;
    res.assert_status_ok();
    assert_eq!(res.json::<Value>()["preset_key"], "walk_alone");
    let res = patch(&app.server, id, json!({"note": "가".repeat(101)})).await;
    assert_error(&res, StatusCode::BAD_REQUEST, "milestone.noteInvalid");
    let res = patch(
        &app.server,
        &Uuid::now_v7().to_string(),
        json!({"note": "x"}),
    )
    .await;
    assert_error(&res, StatusCode::NOT_FOUND, "milestone.notFound");
}

#[sqlx::test]
async fn baby_delete_cascades(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let b = baby(&pool, "2024-01-01").await;
    let a = insert_asset(&pool, AssetSeed::photo(app.user.id)).await;
    create(
        &app.server,
        b,
        json!({"preset_key": "crawl", "achieved_on": "2024-05-01", "asset_ids": [a]}),
    )
    .await;
    app.server
        .delete(&format!("/api/babies/{b}"))
        .add_header(XRW, XRW_VALUE)
        .await
        .assert_status(StatusCode::NO_CONTENT);
    let n = sqlx::query_scalar!(r#"SELECT count(*) AS "n!" FROM milestones"#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 0);
    let n = sqlx::query_scalar!(r#"SELECT count(*) AS "n!" FROM milestone_assets"#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 0);
    app.server
        .get(&format!("/api/assets/{a}"))
        .await
        .assert_status_ok();
}
