mod common;

use std::path::PathBuf;

use axum::http::StatusCode;
use axum_test::{TestResponse, TestServer};
use chrono::{Duration, Utc};
use common::{
    AssetSeed, MediaApp, XRW, XRW_VALUE, assert_error, insert_asset, media_app, upload_bytes,
};
use littledays::{
    assets::queries as asset_queries,
    babies::{self, BabyInput},
    jobs::worker,
    maintenance,
    media::storage,
    settings,
    users::Role,
};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

fn fixture(name: &str) -> Vec<u8> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name);
    std::fs::read(path).unwrap()
}

async fn trash(server: &TestServer, id: Uuid) -> TestResponse {
    server
        .delete(&format!("/api/assets/{id}"))
        .add_header(XRW, XRW_VALUE)
        .await
}

async fn restore(server: &TestServer, id: Uuid) -> TestResponse {
    server
        .post(&format!("/api/assets/{id}/restore"))
        .add_header(XRW, XRW_VALUE)
        .await
}

async fn permanent(server: &TestServer, id: Uuid) -> TestResponse {
    server
        .delete(&format!("/api/assets/{id}/permanent"))
        .add_header(XRW, XRW_VALUE)
        .await
}

async fn ids_of(server: &TestServer, path: &str) -> Vec<Uuid> {
    let res = server.get(path).await;
    res.assert_status_ok();
    res.json::<Value>()["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["id"].as_str().unwrap().parse().unwrap())
        .collect()
}

async fn seed(pool: &PgPool, by: Uuid) -> Uuid {
    insert_asset(pool, AssetSeed::photo(by)).await
}

async fn seed_trashed(pool: &PgPool, by: Uuid, ago: Duration) -> Uuid {
    let mut s = AssetSeed::photo(by);
    s.deleted_at = Some(Utc::now() - ago);
    insert_asset(pool, s).await
}

async fn exists(pool: &PgPool, id: Uuid) -> bool {
    sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM assets WHERE id = $1) AS "e!""#,
        id
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn new_baby(pool: &PgPool) -> Uuid {
    babies::queries::create(
        pool,
        BabyInput {
            name: "하루".to_string(),
            birth_date: "2024-01-01".parse().unwrap(),
            sex: None,
        },
    )
    .await
    .unwrap()
    .id
}

async fn ingest(app: &MediaApp, bytes: &[u8]) -> TestResponse {
    let upload = upload_bytes(app, bytes, "a.jpg").await;
    app.server
        .post(&format!("/api/uploads/{upload}/finalize"))
        .add_header(XRW, XRW_VALUE)
        .json(&json!({}))
        .await
}

#[sqlx::test]
async fn family_cannot_trash(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let id = seed(&pool, app.user.id).await;
    let trashed = seed_trashed(&pool, app.user.id, Duration::days(1)).await;
    let (family, _) = app.login_as("kid", Role::Family).await;

    assert_error(
        &trash(&family, id).await,
        StatusCode::FORBIDDEN,
        "auth.forbidden",
    );
    assert_error(
        &restore(&family, trashed).await,
        StatusCode::FORBIDDEN,
        "auth.forbidden",
    );
    assert_error(
        &permanent(&family, trashed).await,
        StatusCode::FORBIDDEN,
        "auth.forbidden",
    );
    assert_error(
        &family.get("/api/trash").await,
        StatusCode::FORBIDDEN,
        "auth.forbidden",
    );
    let res = family
        .post("/api/trash/empty")
        .add_header(XRW, XRW_VALUE)
        .await;
    assert_error(&res, StatusCode::FORBIDDEN, "auth.forbidden");
}

#[sqlx::test]
async fn trash_and_restore(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let id = seed(&pool, app.user.id).await;

    trash(&app.server, id)
        .await
        .assert_status(StatusCode::NO_CONTENT);
    trash(&app.server, id)
        .await
        .assert_status(StatusCode::NO_CONTENT);
    assert!(!ids_of(&app.server, "/api/assets").await.contains(&id));
    let res = app.server.get("/api/trash").await;
    res.assert_status_ok();
    let body = res.json::<Value>();
    assert_eq!(body["items"][0]["id"], json!(id));
    assert!(body["items"][0]["deleted_at"].is_string());
    assert_eq!(body["next_cursor"], Value::Null);

    let res = restore(&app.server, id).await;
    res.assert_status_ok();
    assert_eq!(res.json::<Value>()["deleted_at"], Value::Null);
    assert!(ids_of(&app.server, "/api/assets").await.contains(&id));
    assert!(ids_of(&app.server, "/api/trash").await.is_empty());

    assert_error(
        &restore(&app.server, id).await,
        StatusCode::CONFLICT,
        "asset.notInTrash",
    );
    assert_error(
        &trash(&app.server, Uuid::now_v7()).await,
        StatusCode::NOT_FOUND,
        "asset.notFound",
    );
}

#[sqlx::test]
async fn trash_lists_newest_first_with_cursor(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let old = seed_trashed(&pool, app.user.id, Duration::days(3)).await;
    let mid = seed_trashed(&pool, app.user.id, Duration::days(2)).await;
    let new = seed_trashed(&pool, app.user.id, Duration::days(1)).await;

    let res = app
        .server
        .get("/api/trash")
        .add_query_param("limit", 2)
        .await;
    let page = res.json::<Value>();
    let cursor = page["next_cursor"].as_str().unwrap().to_string();
    assert_eq!(page["items"][0]["id"], json!(new));
    assert_eq!(page["items"][1]["id"], json!(mid));
    let rest = ids_of(&app.server, &format!("/api/trash?limit=2&cursor={cursor}")).await;
    assert_eq!(rest, vec![old]);
}

#[sqlx::test]
async fn permanent_requires_trash(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let id = seed(&pool, app.user.id).await;

    assert_error(
        &permanent(&app.server, id).await,
        StatusCode::CONFLICT,
        "asset.notInTrash",
    );
    assert_error(
        &permanent(&app.server, Uuid::now_v7()).await,
        StatusCode::NOT_FOUND,
        "asset.notFound",
    );
    assert!(exists(&pool, id).await);
}

#[sqlx::test]
async fn trash_clears_avatar_and_restore_keeps_it_cleared(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let id = seed(&pool, app.user.id).await;
    let baby = new_baby(&pool).await;
    let put = |avatar: Option<Uuid>| {
        app.server
            .put(&format!("/api/babies/{baby}"))
            .add_header(XRW, XRW_VALUE)
            .json(&json!({ "name": "하루", "birth_date": "2024-01-01", "avatar_asset_id": avatar }))
    };
    put(Some(id)).await.assert_status_ok();

    trash(&app.server, id)
        .await
        .assert_status(StatusCode::NO_CONTENT);
    let list = app.server.get("/api/babies").await.json::<Value>();
    assert_eq!(list[0]["avatar_asset_id"], Value::Null);
    put(None).await.assert_status_ok();

    restore(&app.server, id).await.assert_status_ok();
    let list = app.server.get("/api/babies").await.json::<Value>();
    assert_eq!(list[0]["avatar_asset_id"], Value::Null);
}

#[sqlx::test]
async fn permanent_delete_clears_avatar_and_allows_reupload(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let bytes = fixture("orient6.jpg");
    let res = ingest(&app, &bytes).await;
    res.assert_status(StatusCode::CREATED);
    let id: Uuid = res.json::<Value>()["id"].as_str().unwrap().parse().unwrap();
    assert!(worker::run_next(&app.state).await.unwrap());
    let baby = new_baby(&pool).await;
    asset_queries::add_babies(&pool, id, &[baby], app.user.id)
        .await
        .unwrap();
    let original = app.data.path().join(
        sqlx::query_scalar!("SELECT original_path FROM assets WHERE id = $1", id)
            .fetch_one(&pool)
            .await
            .unwrap(),
    );
    let derivatives = storage::derivative_dir(app.data.path(), id);
    assert!(original.is_file());
    assert!(derivatives.is_dir());

    trash(&app.server, id)
        .await
        .assert_status(StatusCode::NO_CONTENT);
    sqlx::query!(
        "UPDATE babies SET avatar_asset_id = $1 WHERE id = $2",
        id,
        baby
    )
    .execute(&pool)
    .await
    .unwrap();
    permanent(&app.server, id)
        .await
        .assert_status(StatusCode::NO_CONTENT);

    assert!(!exists(&pool, id).await);
    let tags = sqlx::query_scalar!(
        r#"SELECT count(*) AS "n!" FROM asset_babies WHERE asset_id = $1"#,
        id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(tags, 0);
    let avatar = sqlx::query_scalar!("SELECT avatar_asset_id FROM babies WHERE id = $1", baby)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(avatar, None);
    let jobs = sqlx::query_scalar!(r#"SELECT count(*) AS "n!" FROM jobs"#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(jobs, 0);
    assert!(!original.exists());
    assert!(!derivatives.exists());

    ingest(&app, &bytes)
        .await
        .assert_status(StatusCode::CREATED);
}

#[sqlx::test]
async fn empty_trash(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    for _ in 0..3 {
        seed_trashed(&pool, app.user.id, Duration::days(1)).await;
    }
    let kept = seed(&pool, app.user.id).await;

    let res = app
        .server
        .post("/api/trash/empty")
        .add_header(XRW, XRW_VALUE)
        .await;
    res.assert_status_ok();
    res.assert_json(&json!({ "deleted": 3 }));
    assert!(ids_of(&app.server, "/api/trash").await.is_empty());
    assert!(exists(&pool, kept).await);
}

#[sqlx::test]
async fn retention_purges_old_trash(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let old = seed_trashed(&pool, app.user.id, Duration::days(31)).await;
    let recent = seed_trashed(&pool, app.user.id, Duration::days(29)).await;

    maintenance::run_once(&app.state).await.unwrap();
    assert!(exists(&pool, old).await);
    assert!(exists(&pool, recent).await);

    settings::queries::set(&pool, "trash_retention_days", json!(30))
        .await
        .unwrap();
    maintenance::run_once(&app.state).await.unwrap();
    assert!(!exists(&pool, old).await);
    assert!(exists(&pool, recent).await);
}

#[sqlx::test]
async fn permanent_delete_removes_failed_job_rows(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let id = seed(&pool, app.user.id).await;
    sqlx::query!("UPDATE assets SET status = 'failed' WHERE id = $1", id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query!(
        "INSERT INTO jobs (id, kind, payload, status, attempts, last_error)
         VALUES ($1, 'process_asset', $2, 'failed', 3, 'boom')",
        Uuid::now_v7(),
        json!({ "asset_id": id })
    )
    .execute(&pool)
    .await
    .unwrap();
    let count = || async {
        sqlx::query_scalar!(r#"SELECT count(*) AS "n!" FROM jobs"#)
            .fetch_one(&pool)
            .await
            .unwrap()
    };
    assert_eq!(count().await, 1);

    trash(&app.server, id)
        .await
        .assert_status(StatusCode::NO_CONTENT);
    permanent(&app.server, id)
        .await
        .assert_status(StatusCode::NO_CONTENT);
    assert!(!exists(&pool, id).await);
    assert_eq!(count().await, 0);
}

#[sqlx::test]
async fn retention_spares_item_trashed_again_after_restore(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let id = seed_trashed(&pool, app.user.id, Duration::days(31)).await;
    settings::queries::set(&pool, "trash_retention_days", json!(30))
        .await
        .unwrap();
    restore(&app.server, id).await.assert_status_ok();
    trash(&app.server, id)
        .await
        .assert_status(StatusCode::NO_CONTENT);
    maintenance::run_once(&app.state).await.unwrap();
    assert!(exists(&pool, id).await);
}
