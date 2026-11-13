mod common;

use axum::http::StatusCode;
use axum_test::TestServer;
use chrono::{DateTime, Duration, TimeZone, Utc};
use common::{AssetSeed, XRW, XRW_VALUE, assert_error, insert_asset, media_app};
use littledays::{
    assets,
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

async fn seed(pool: &PgPool, by: Uuid, taken_at: DateTime<Utc>) -> Uuid {
    let mut s = AssetSeed::photo(by);
    s.taken_at = taken_at;
    insert_asset(pool, s).await
}

fn ids(page: &Value) -> Vec<Uuid> {
    page["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["id"].as_str().unwrap().parse().unwrap())
        .collect()
}

async fn patch(server: &TestServer, id: Uuid, body: Value) -> axum_test::TestResponse {
    server
        .patch(&format!("/api/assets/{id}"))
        .add_header(XRW, XRW_VALUE)
        .json(&body)
        .await
}

async fn put_babies(server: &TestServer, id: Uuid, baby_ids: &[Uuid]) -> axum_test::TestResponse {
    server
        .put(&format!("/api/assets/{id}/babies"))
        .add_header(XRW, XRW_VALUE)
        .json(&json!({ "baby_ids": baby_ids }))
        .await
}

#[sqlx::test]
async fn list_paginates_without_gaps(pool: PgPool) {
    let app = media_app(&pool, Role::Family).await;
    let t = Utc.with_ymd_and_hms(2024, 5, 1, 0, 0, 0).unwrap();
    let mut expected = Vec::new();
    for taken in [t, t, t, t + Duration::hours(1), t + Duration::hours(2)] {
        expected.push((taken, seed(&pool, app.user.id, taken).await));
    }
    for taken in [t - Duration::days(1), t - Duration::days(2)] {
        expected.push((taken, seed(&pool, app.user.id, taken).await));
    }
    expected.sort_by(|a, b| b.cmp(a));
    let expected: Vec<Uuid> = expected.into_iter().map(|(_, id)| id).collect();

    let mut got = Vec::new();
    let mut cursor: Option<String> = None;
    loop {
        let mut req = app.server.get("/api/assets").add_query_param("limit", 3);
        if let Some(c) = &cursor {
            req = req.add_query_param("cursor", c);
        }
        let page: Value = req.await.json();
        got.extend(ids(&page));
        match page["next_cursor"].as_str() {
            Some(c) => cursor = Some(c.to_string()),
            None => break,
        }
    }
    assert_eq!(got, expected);
}

#[sqlx::test]
async fn list_excludes_trash_and_filters_baby(pool: PgPool) {
    let app = media_app(&pool, Role::Family).await;
    let a = baby(&pool, "a").await;
    let tagged = seed(&pool, app.user.id, Utc::now()).await;
    let untagged = seed(&pool, app.user.id, Utc::now()).await;
    let mut trashed = AssetSeed::photo(app.user.id);
    trashed.deleted_at = Some(Utc::now());
    let trashed = insert_asset(&pool, trashed).await;
    assets::queries::add_babies(&pool, tagged, &[a], app.user.id)
        .await
        .unwrap();
    assets::queries::add_babies(&pool, trashed, &[a], app.user.id)
        .await
        .unwrap();

    let all: Value = app.server.get("/api/assets").await.json();
    let all = ids(&all);
    assert_eq!(all.len(), 2);
    assert!(all.contains(&tagged) && all.contains(&untagged));

    let filtered: Value = app
        .server
        .get("/api/assets")
        .add_query_param("baby_id", a)
        .await
        .json();
    assert_eq!(ids(&filtered), vec![tagged]);
    assert_eq!(filtered["items"][0]["baby_ids"], json!([a]));
}

#[sqlx::test]
async fn local_date_uses_timezone(pool: PgPool) {
    let app = media_app(&pool, Role::Family).await;
    seed(
        &pool,
        app.user.id,
        Utc.with_ymd_and_hms(2024, 5, 1, 16, 0, 0).unwrap(),
    )
    .await;
    let page: Value = app.server.get("/api/assets").await.json();
    assert_eq!(page["items"][0]["local_date"], "2024-05-02");

    settings::queries::set(&pool, "timezone", json!("UTC"))
        .await
        .unwrap();
    let page: Value = app.server.get("/api/assets").await.json();
    assert_eq!(page["items"][0]["local_date"], "2024-05-01");
}

#[sqlx::test]
async fn months_counts(pool: PgPool) {
    let app = media_app(&pool, Role::Family).await;
    for (m, d) in [(4, 3), (4, 20), (5, 2)] {
        seed(
            &pool,
            app.user.id,
            Utc.with_ymd_and_hms(2024, m, d, 3, 0, 0).unwrap(),
        )
        .await;
    }
    let mut trashed = AssetSeed::photo(app.user.id);
    trashed.taken_at = Utc.with_ymd_and_hms(2024, 5, 3, 3, 0, 0).unwrap();
    trashed.deleted_at = Some(Utc::now());
    insert_asset(&pool, trashed).await;

    let res = app.server.get("/api/assets/months").await;
    res.assert_status_ok();
    res.assert_json(&json!([
        {"month": "2024-05", "count": 1},
        {"month": "2024-04", "count": 2},
    ]));
}

#[sqlx::test]
async fn invalid_query_rejected(pool: PgPool) {
    let app = media_app(&pool, Role::Family).await;
    let res = app
        .server
        .get("/api/assets")
        .add_query_param("cursor", "zzz")
        .await;
    assert_error(&res, StatusCode::BAD_REQUEST, "asset.invalidCursor");
    for limit in ["0", "501", "abc"] {
        let res = app
            .server
            .get("/api/assets")
            .add_query_param("limit", limit)
            .await;
        assert_error(&res, StatusCode::BAD_REQUEST, "request.invalidQuery");
    }
}

#[sqlx::test]
async fn detail_hides_trash_from_family(pool: PgPool) {
    let app = media_app(&pool, Role::Family).await;
    let (guardian, _) = app.login_as("dad", Role::Guardian).await;
    let mut s = AssetSeed::photo(app.user.id);
    s.deleted_at = Some(Utc::now());
    let id = insert_asset(&pool, s).await;
    let url = format!("/api/assets/{id}");

    let res = app.server.get(&url).await;
    assert_error(&res, StatusCode::NOT_FOUND, "asset.notFound");
    let res = guardian.get(&url).await;
    res.assert_status_ok();
    assert!(!res.json::<Value>()["deleted_at"].is_null());
}

#[sqlx::test]
async fn patch_caption_and_taken_at(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let (family, _) = app.login_as("kid", Role::Family).await;
    let id = seed(&pool, app.user.id, Utc::now()).await;

    let res = patch(&app.server, id, json!({"caption": "  첫 걸음  "})).await;
    res.assert_status_ok();
    assert_eq!(res.json::<Value>()["caption"], "첫 걸음");
    let res = patch(&app.server, id, json!({"taken_at": "2023-01-01T00:00:00Z"})).await;
    assert_eq!(res.json::<Value>()["caption"], "첫 걸음");
    let res = patch(&app.server, id, json!({"caption": ""})).await;
    assert!(res.json::<Value>()["caption"].is_null());
    patch(&app.server, id, json!({"caption": "다시"})).await;
    let res = patch(&app.server, id, json!({"caption": null})).await;
    res.assert_status_ok();
    assert!(res.json::<Value>()["caption"].is_null());
    let res = patch(&app.server, id, json!({"caption": "a".repeat(2001)})).await;
    assert_error(&res, StatusCode::BAD_REQUEST, "asset.captionTooLong");

    let res = patch(&app.server, id, json!({"taken_at": "2023-01-02T03:04:05Z"})).await;
    res.assert_status_ok();
    let body: Value = res.json();
    assert_eq!(body["taken_at_source"], "manual");
    assert_eq!(body["taken_at"], "2023-01-02T03:04:05Z");

    let res = patch(&family, id, json!({"caption": "x"})).await;
    res.assert_status(StatusCode::FORBIDDEN);
}

#[sqlx::test]
async fn put_babies_replaces_tags(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let (a, b, c) = (
        baby(&pool, "a").await,
        baby(&pool, "b").await,
        baby(&pool, "c").await,
    );
    let id = seed(&pool, app.user.id, Utc::now()).await;
    let other = app.login_as("dad", Role::Guardian).await;

    put_babies(&app.server, id, &[a, b])
        .await
        .assert_status_ok();
    let tagged_at = |baby_id: Uuid| {
        let pool = pool.clone();
        async move {
            sqlx::query_scalar!(
                "SELECT tagged_at FROM asset_babies WHERE asset_id = $1 AND baby_id = $2",
                id,
                baby_id
            )
            .fetch_one(&pool)
            .await
            .unwrap()
        }
    };
    let b_before = tagged_at(b).await;

    let res = put_babies(&other.0, id, &[b, c]).await;
    res.assert_status_ok();
    assert_eq!(res.json::<Value>()["baby_ids"], json!([b, c]));
    assert_eq!(tagged_at(b).await, b_before);
    let by = sqlx::query_scalar!(
        "SELECT tagged_by FROM asset_babies WHERE asset_id = $1 AND baby_id = $2",
        id,
        c
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(by, other.1.id);

    let res = put_babies(&app.server, id, &[a, Uuid::now_v7()]).await;
    assert_error(&res, StatusCode::BAD_REQUEST, "asset.babyInvalid");
    let detail: Value = app.server.get(&format!("/api/assets/{id}")).await.json();
    assert_eq!(detail["baby_ids"], json!([b, c]));
}

#[sqlx::test]
async fn list_by_date(pool: PgPool) {
    let app = media_app(&pool, Role::Family).await;
    settings::queries::set(&pool, "timezone", json!("Asia/Seoul"))
        .await
        .unwrap();
    // 현지 05-01 23:30, 05-02 00:30·01:30, 05-03 00:30
    let t = Utc.with_ymd_and_hms(2024, 5, 1, 14, 30, 0).unwrap();
    seed(&pool, app.user.id, t).await;
    let a = seed(&pool, app.user.id, t + Duration::hours(1)).await;
    let b = seed(&pool, app.user.id, t + Duration::hours(2)).await;
    seed(
        &pool,
        app.user.id,
        t + Duration::days(1) + Duration::hours(1),
    )
    .await;
    let mut trashed = AssetSeed::photo(app.user.id);
    trashed.taken_at = t + Duration::hours(3);
    trashed.deleted_at = Some(Utc::now());
    insert_asset(&pool, trashed).await;

    let page: Value = app
        .server
        .get("/api/assets")
        .add_query_param("date", "2024-05-02")
        .await
        .json();
    assert_eq!(ids(&page), vec![b, a]);

    let first: Value = app
        .server
        .get("/api/assets")
        .add_query_param("date", "2024-05-02")
        .add_query_param("limit", 1)
        .await
        .json();
    assert_eq!(ids(&first), vec![b]);
    let second: Value = app
        .server
        .get("/api/assets")
        .add_query_param("date", "2024-05-02")
        .add_query_param("limit", 1)
        .add_query_param("cursor", first["next_cursor"].as_str().unwrap())
        .await
        .json();
    assert_eq!(ids(&second), vec![a]);
    assert!(second["next_cursor"].is_null());

    let res = app
        .server
        .get("/api/assets")
        .add_query_param("date", "05/02")
        .await;
    assert_error(&res, StatusCode::BAD_REQUEST, "request.invalidQuery");
}

#[sqlx::test]
async fn summary_has_uploaded_by(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let (_, dad) = app.login_as("dad", Role::Guardian).await;
    let id = seed(&pool, dad.id, Utc::now()).await;

    let page: Value = app.server.get("/api/assets").await.json();
    assert_eq!(page["items"][0]["uploaded_by"], json!(dad.id));
    let detail: Value = app.server.get(&format!("/api/assets/{id}")).await.json();
    assert_eq!(detail["uploaded_by"], json!(dad.id));

    app.server
        .delete(&format!("/api/assets/{id}"))
        .add_header(XRW, XRW_VALUE)
        .await
        .assert_status(StatusCode::NO_CONTENT);
    let trash: Value = app.server.get("/api/trash").await.json();
    assert_eq!(trash["items"][0]["uploaded_by"], json!(dad.id));
}

#[sqlx::test]
async fn list_kind_video(pool: PgPool) {
    let app = media_app(&pool, Role::Family).await;
    let a = baby(&pool, "a").await;
    let photo = seed(&pool, app.user.id, Utc::now()).await;
    let mut v = AssetSeed::photo(app.user.id);
    v.kind = "video";
    let video = insert_asset(&pool, v).await;
    let mut v2 = AssetSeed::photo(app.user.id);
    v2.kind = "video";
    let other_video = insert_asset(&pool, v2).await;
    for id in [photo, video] {
        assets::queries::add_babies(&pool, id, &[a], app.user.id)
            .await
            .unwrap();
    }

    let page: Value = app
        .server
        .get("/api/assets")
        .add_query_param("kind", "video")
        .await
        .json();
    let got = ids(&page);
    assert_eq!(got.len(), 2);
    assert!(got.contains(&video) && got.contains(&other_video));

    let page: Value = app
        .server
        .get("/api/assets")
        .add_query_param("kind", "video")
        .add_query_param("baby_id", a)
        .await
        .json();
    assert_eq!(ids(&page), vec![video]);
}
