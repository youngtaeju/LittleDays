mod common;

use axum::http::StatusCode;
use axum_test::{TestResponse, TestServer};
use chrono::{DateTime, Duration, TimeZone, Utc};
use common::{AssetSeed, XRW, XRW_VALUE, assert_error, insert_asset, media_app};
use littledays::users::Role;
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

async fn put(server: &TestServer, id: Uuid, what: &str) -> TestResponse {
    server
        .put(&format!("/api/assets/{id}/{what}"))
        .add_header(XRW, XRW_VALUE)
        .await
}

async fn delete(server: &TestServer, id: Uuid, what: &str) -> TestResponse {
    server
        .delete(&format!("/api/assets/{id}/{what}"))
        .add_header(XRW, XRW_VALUE)
        .await
}

async fn detail(server: &TestServer, id: Uuid) -> Value {
    let res = server.get(&format!("/api/assets/{id}")).await;
    res.assert_status_ok();
    res.json()
}

async fn trash(server: &TestServer, id: Uuid) {
    server
        .delete(&format!("/api/assets/{id}"))
        .add_header(XRW, XRW_VALUE)
        .await
        .assert_status(StatusCode::NO_CONTENT);
}

async fn seed(pool: &PgPool, by: Uuid) -> Uuid {
    insert_asset(pool, AssetSeed::photo(by)).await
}

fn ids(page: &Value) -> Vec<Uuid> {
    page["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["id"].as_str().unwrap().parse().unwrap())
        .collect()
}

fn at(minute: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2024, 5, 1, 12, minute, 0).unwrap()
}

/// 생성 순서와 무관한 정렬 검증용 시각 고정.
async fn set_like_time(pool: &PgPool, asset: Uuid, user: Uuid, ts: DateTime<Utc>) {
    sqlx::query!(
        "UPDATE asset_likes SET created_at = $3 WHERE asset_id = $1 AND user_id = $2",
        asset,
        user,
        ts
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn set_favorite_time(pool: &PgPool, asset: Uuid, user: Uuid, ts: DateTime<Utc>) {
    sqlx::query!(
        "UPDATE asset_favorites SET created_at = $3 WHERE asset_id = $1 AND user_id = $2",
        asset,
        user,
        ts
    )
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test]
async fn like_put_delete_idempotent(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let id = seed(&pool, app.user.id).await;

    for _ in 0..2 {
        put(&app.server, id, "like")
            .await
            .assert_status(StatusCode::NO_CONTENT);
    }
    let asset = detail(&app.server, id).await;
    assert_eq!(asset["like_count"], 1);
    assert_eq!(asset["liked"], true);

    for _ in 0..2 {
        delete(&app.server, id, "like")
            .await
            .assert_status(StatusCode::NO_CONTENT);
    }
    let asset = detail(&app.server, id).await;
    assert_eq!(asset["like_count"], 0);
    assert_eq!(asset["liked"], false);

    for _ in 0..2 {
        put(&app.server, id, "favorite")
            .await
            .assert_status(StatusCode::NO_CONTENT);
    }
    assert_eq!(detail(&app.server, id).await["favorited"], true);
    for _ in 0..2 {
        delete(&app.server, id, "favorite")
            .await
            .assert_status(StatusCode::NO_CONTENT);
    }
    assert_eq!(detail(&app.server, id).await["favorited"], false);
}

#[sqlx::test]
async fn asset_shows_counts_and_mine(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let (b, _) = app.login_as("dad", Role::Guardian).await;
    let id = seed(&pool, app.user.id).await;

    let fresh = detail(&app.server, id).await;
    assert_eq!(fresh["like_count"], 0);
    assert_eq!(fresh["comment_count"], 0);
    assert_eq!(fresh["liked"], false);
    assert_eq!(fresh["favorited"], false);

    put(&app.server, id, "like").await;
    put(&b, id, "like").await;
    put(&app.server, id, "favorite").await;

    let mine = detail(&app.server, id).await;
    assert_eq!(mine["like_count"], 2);
    assert_eq!(mine["liked"], true);
    assert_eq!(mine["favorited"], true);
    let theirs = detail(&b, id).await;
    assert_eq!(theirs["like_count"], 2);
    assert_eq!(theirs["liked"], true);
    assert_eq!(theirs["favorited"], false);
}

#[sqlx::test]
async fn likes_list_newest_first(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let (b, dad) = app.login_as("dad", Role::Guardian).await;
    let id = seed(&pool, app.user.id).await;
    put(&app.server, id, "like").await;
    put(&b, id, "like").await;
    // 먼저 누른 쪽을 더 최근으로
    set_like_time(&pool, id, app.user.id, at(10)).await;
    set_like_time(&pool, id, dad.id, at(5)).await;

    let res = app.server.get(&format!("/api/assets/{id}/likes")).await;
    res.assert_status_ok();
    let likes: Value = res.json();
    let users: Vec<&str> = likes
        .as_array()
        .unwrap()
        .iter()
        .map(|l| l["user_id"].as_str().unwrap())
        .collect();
    assert_eq!(users, [app.user.id.to_string(), dad.id.to_string()]);
    assert_eq!(likes[0]["created_at"], "2024-05-01T12:10:00Z");
}

#[sqlx::test]
async fn family_can_like_and_favorite(pool: PgPool) {
    let app = media_app(&pool, Role::Family).await;
    let id = seed(&pool, app.user.id).await;

    put(&app.server, id, "like")
        .await
        .assert_status(StatusCode::NO_CONTENT);
    put(&app.server, id, "favorite")
        .await
        .assert_status(StatusCode::NO_CONTENT);
    let asset = detail(&app.server, id).await;
    assert_eq!(asset["liked"], true);
    assert_eq!(asset["favorited"], true);
    app.server
        .get(&format!("/api/assets/{id}/likes"))
        .await
        .assert_status_ok();
    let favorites: Value = app.server.get("/api/favorites").await.json();
    assert_eq!(ids(&favorites), [id]);

    delete(&app.server, id, "like")
        .await
        .assert_status(StatusCode::NO_CONTENT);
    delete(&app.server, id, "favorite")
        .await
        .assert_status(StatusCode::NO_CONTENT);
}

#[sqlx::test]
async fn trashed_asset_reactions_404(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let mut s = AssetSeed::photo(app.user.id);
    s.deleted_at = Some(Utc::now() - Duration::days(1));
    let trashed = insert_asset(&pool, s).await;

    for id in [trashed, Uuid::now_v7()] {
        for what in ["like", "favorite"] {
            assert_error(
                &put(&app.server, id, what).await,
                StatusCode::NOT_FOUND,
                "asset.notFound",
            );
            assert_error(
                &delete(&app.server, id, what).await,
                StatusCode::NOT_FOUND,
                "asset.notFound",
            );
        }
        let res = app.server.get(&format!("/api/assets/{id}/likes")).await;
        assert_error(&res, StatusCode::NOT_FOUND, "asset.notFound");
    }
}

#[sqlx::test]
async fn restore_keeps_reactions(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let id = seed(&pool, app.user.id).await;
    put(&app.server, id, "like").await;
    put(&app.server, id, "favorite").await;

    trash(&app.server, id).await;
    let favorites: Value = app.server.get("/api/favorites").await.json();
    assert!(ids(&favorites).is_empty());
    app.server
        .post(&format!("/api/assets/{id}/restore"))
        .add_header(XRW, XRW_VALUE)
        .await
        .assert_status_ok();

    let asset = detail(&app.server, id).await;
    assert_eq!(asset["like_count"], 1);
    assert_eq!(asset["liked"], true);
    assert_eq!(asset["favorited"], true);
    let favorites: Value = app.server.get("/api/favorites").await.json();
    assert_eq!(ids(&favorites), [id]);
}

#[sqlx::test]
async fn permanent_delete_cascades(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let id = seed(&pool, app.user.id).await;
    for what in ["like", "favorite"] {
        put(&app.server, id, what)
            .await
            .assert_status(StatusCode::NO_CONTENT);
    }

    trash(&app.server, id).await;
    app.server
        .delete(&format!("/api/assets/{id}/permanent"))
        .add_header(XRW, XRW_VALUE)
        .await
        .assert_status(StatusCode::NO_CONTENT);

    let likes = sqlx::query_scalar!(
        r#"SELECT count(*) AS "n!" FROM asset_likes WHERE asset_id = $1"#,
        id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let favorites = sqlx::query_scalar!(
        r#"SELECT count(*) AS "n!" FROM asset_favorites WHERE asset_id = $1"#,
        id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!((likes, favorites), (0, 0));
}

#[sqlx::test]
async fn favorites_page_cursor_excludes_trash(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let (b, dad) = app.login_as("dad", Role::Guardian).await;
    let older = seed(&pool, app.user.id).await;
    let newer = seed(&pool, app.user.id).await;
    let gone = seed(&pool, app.user.id).await;
    let others = seed(&pool, app.user.id).await;
    for (id, minute) in [(older, 1), (newer, 3), (gone, 5)] {
        put(&app.server, id, "favorite").await;
        set_favorite_time(&pool, id, app.user.id, at(minute)).await;
    }
    for id in [older, others] {
        put(&b, id, "favorite").await;
        set_favorite_time(&pool, id, dad.id, at(9)).await;
    }
    trash(&app.server, gone).await;

    let res = app
        .server
        .get("/api/favorites")
        .add_query_param("limit", 1)
        .await;
    res.assert_status_ok();
    let first: Value = res.json();
    assert_eq!(ids(&first), [newer]);
    let cursor = first["next_cursor"].as_str().unwrap().to_string();

    let second: Value = app
        .server
        .get("/api/favorites")
        .add_query_param("limit", 1)
        .add_query_param("cursor", &cursor)
        .await
        .json();
    assert_eq!(ids(&second), [older]);
    assert!(second["next_cursor"].is_null());

    let all: Value = app.server.get("/api/favorites").await.json();
    assert_eq!(ids(&all), [newer, older]);
    assert!(all["items"][0]["local_date"].is_string());
    let theirs: Value = b.get("/api/favorites").await.json();
    assert_eq!(ids(&theirs).len(), 2);

    for limit in ["0", "501", "x"] {
        let res = app
            .server
            .get("/api/favorites")
            .add_query_param("limit", limit)
            .await;
        assert_error(&res, StatusCode::BAD_REQUEST, "request.invalidQuery");
    }
    let res = app
        .server
        .get("/api/favorites")
        .add_query_param("cursor", "zzz")
        .await;
    assert_error(&res, StatusCode::BAD_REQUEST, "asset.invalidCursor");
}

#[sqlx::test]
async fn reactions_require_csrf(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let id = seed(&pool, app.user.id).await;
    for what in ["like", "favorite"] {
        let res = app.server.put(&format!("/api/assets/{id}/{what}")).await;
        assert_error(&res, StatusCode::FORBIDDEN, "auth.csrf");
        let res = app.server.delete(&format!("/api/assets/{id}/{what}")).await;
        assert_error(&res, StatusCode::FORBIDDEN, "auth.csrf");
    }
}
