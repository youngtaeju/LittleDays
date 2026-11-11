mod common;

use axum::http::StatusCode;
use axum_test::{TestResponse, TestServer};
use chrono::{Duration, Utc};
use common::{AssetSeed, XRW, XRW_VALUE, assert_error, insert_asset, media_app};
use littledays::{app::build_router, users::Role};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

async fn post(server: &TestServer, asset: Uuid, body: &str) -> TestResponse {
    server
        .post(&format!("/api/assets/{asset}/comments"))
        .add_header(XRW, XRW_VALUE)
        .json(&json!({ "body": body }))
        .await
}

async fn post_ok(server: &TestServer, asset: Uuid, body: &str) -> Value {
    let res = post(server, asset, body).await;
    res.assert_status(StatusCode::CREATED);
    res.json()
}

async fn patch(server: &TestServer, id: &str, body: &str) -> TestResponse {
    server
        .patch(&format!("/api/comments/{id}"))
        .add_header(XRW, XRW_VALUE)
        .json(&json!({ "body": body }))
        .await
}

async fn delete(server: &TestServer, id: &str) -> TestResponse {
    server
        .delete(&format!("/api/comments/{id}"))
        .add_header(XRW, XRW_VALUE)
        .await
}

fn bodies(page: &Value) -> Vec<&str> {
    page["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["body"].as_str().unwrap())
        .collect()
}

#[sqlx::test]
async fn post_and_list_oldest_first(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let asset = insert_asset(&pool, AssetSeed::photo(app.user.id)).await;
    for body in ["첫째", "둘째", "셋째"] {
        let c = post_ok(&app.server, asset, body).await;
        assert_eq!(c["author_id"], app.user.id.to_string());
        assert_eq!(c["asset_id"], asset.to_string());
        assert!(c["edited_at"].is_null());
    }
    let page: Value = app
        .server
        .get(&format!("/api/assets/{asset}/comments"))
        .await
        .json();
    assert_eq!(bodies(&page), ["첫째", "둘째", "셋째"]);
    assert!(page["next_cursor"].is_null());
}

#[sqlx::test]
async fn list_cursor_pages(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let asset = insert_asset(&pool, AssetSeed::photo(app.user.id)).await;
    for body in ["a", "b", "c"] {
        post_ok(&app.server, asset, body).await;
    }
    let url = format!("/api/assets/{asset}/comments");
    let first: Value = app.server.get(&format!("{url}?limit=2")).await.json();
    assert_eq!(bodies(&first), ["a", "b"]);
    let cursor = first["next_cursor"].as_str().unwrap();
    let second: Value = app
        .server
        .get(&format!("{url}?limit=2&cursor={cursor}"))
        .await
        .json();
    assert_eq!(bodies(&second), ["c"]);
    assert!(second["next_cursor"].is_null());

    for bad in ["limit=0", "limit=101"] {
        let res = app.server.get(&format!("{url}?{bad}")).await;
        assert_error(&res, StatusCode::BAD_REQUEST, "request.invalidQuery");
    }
}

#[sqlx::test]
async fn body_length_counts_chars(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let asset = insert_asset(&pool, AssetSeed::photo(app.user.id)).await;
    post_ok(&app.server, asset, &"😀".repeat(1000)).await;
    assert_error(
        &post(&app.server, asset, &"😀".repeat(1001)).await,
        StatusCode::BAD_REQUEST,
        "comment.bodyInvalid",
    );
    assert_error(
        &post(&app.server, asset, "  \n ").await,
        StatusCode::BAD_REQUEST,
        "comment.bodyInvalid",
    );
    let c = post_ok(&app.server, asset, "  안녕\n ").await;
    assert_eq!(c["body"], "안녕");
}

#[sqlx::test]
async fn mention_must_be_user(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let asset = insert_asset(&pool, AssetSeed::photo(app.user.id)).await;
    let body = format!("안녕 <@{}>", app.user.id);
    assert_eq!(post_ok(&app.server, asset, &body).await["body"], body);
    assert_error(
        &post(&app.server, asset, &format!("<@{}>", Uuid::now_v7())).await,
        StatusCode::BAD_REQUEST,
        "comment.mentionInvalid",
    );
    assert_error(
        &post(
            &app.server,
            asset,
            &format!("<@{}> <@{}>", app.user.id, Uuid::now_v7()),
        )
        .await,
        StatusCode::BAD_REQUEST,
        "comment.mentionInvalid",
    );
    post_ok(&app.server, asset, "<@abc>").await;
    let upper = format!("<@{}>", Uuid::now_v7()).to_uppercase();
    post_ok(&app.server, asset, &upper).await;

    let c = post_ok(&app.server, asset, "고칠 것").await;
    let res = patch(
        &app.server,
        c["id"].as_str().unwrap(),
        &format!("<@{}>", Uuid::now_v7()),
    )
    .await;
    assert_error(&res, StatusCode::BAD_REQUEST, "comment.mentionInvalid");
}

#[sqlx::test]
async fn edit_own_only(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let asset = insert_asset(&pool, AssetSeed::photo(app.user.id)).await;
    let (family, _) = app.login_as("aunt", Role::Family).await;
    let c = post_ok(&family, asset, "원본").await;
    let id = c["id"].as_str().unwrap();

    assert_error(
        &patch(&app.server, id, "남이 고침").await,
        StatusCode::FORBIDDEN,
        "comment.forbidden",
    );
    assert_error(
        &patch(&family, id, " ").await,
        StatusCode::BAD_REQUEST,
        "comment.bodyInvalid",
    );
    let res = patch(&family, id, " 고침 ").await;
    res.assert_status_ok();
    let edited: Value = res.json();
    assert_eq!(edited["body"], "고침");
    assert!(!edited["edited_at"].is_null());
    assert_eq!(edited["created_at"], c["created_at"]);
}

#[sqlx::test]
async fn edit_with_valid_mention(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let asset = insert_asset(&pool, AssetSeed::photo(app.user.id)).await;
    let c = post_ok(&app.server, asset, "원본").await;
    let input = format!(" 안녕 <@{}> ", app.user.id);
    let res = patch(&app.server, c["id"].as_str().unwrap(), &input).await;
    res.assert_status_ok();
    let edited: Value = res.json();
    assert_eq!(edited["body"], input.trim());
    assert!(!edited["edited_at"].is_null());
}

#[sqlx::test]
async fn delete_matrix(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let asset = insert_asset(&pool, AssetSeed::photo(app.user.id)).await;
    let (guardian, _) = app.login_as("dad", Role::Guardian).await;
    let (family, _) = app.login_as("aunt", Role::Family).await;

    let theirs = post_ok(&app.server, asset, "owner 글").await;
    let theirs = theirs["id"].as_str().unwrap();
    assert_error(
        &delete(&family, theirs).await,
        StatusCode::FORBIDDEN,
        "comment.forbidden",
    );
    delete(&guardian, theirs)
        .await
        .assert_status(StatusCode::NO_CONTENT);

    let mine = post_ok(&family, asset, "family 글").await;
    delete(&app.server, mine["id"].as_str().unwrap())
        .await
        .assert_status(StatusCode::NO_CONTENT);

    let mine = post_ok(&family, asset, "내 글").await;
    delete(&family, mine["id"].as_str().unwrap())
        .await
        .assert_status(StatusCode::NO_CONTENT);
    assert_error(
        &delete(&family, mine["id"].as_str().unwrap()).await,
        StatusCode::NOT_FOUND,
        "comment.notFound",
    );
}

#[sqlx::test]
async fn trashed_asset_comments_404(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let asset = insert_asset(&pool, AssetSeed::photo(app.user.id)).await;
    let c = post_ok(&app.server, asset, "남길 글").await;
    let id = c["id"].as_str().unwrap();
    app.server
        .delete(&format!("/api/assets/{asset}"))
        .add_header(XRW, XRW_VALUE)
        .await
        .assert_status(StatusCode::NO_CONTENT);

    let res = app
        .server
        .get(&format!("/api/assets/{asset}/comments"))
        .await;
    assert_error(&res, StatusCode::NOT_FOUND, "asset.notFound");
    assert_error(
        &post(&app.server, asset, "x").await,
        StatusCode::NOT_FOUND,
        "asset.notFound",
    );
    assert_error(
        &patch(&app.server, id, "x").await,
        StatusCode::NOT_FOUND,
        "comment.notFound",
    );
    assert_error(
        &delete(&app.server, id).await,
        StatusCode::NOT_FOUND,
        "comment.notFound",
    );

    let mut s = AssetSeed::photo(app.user.id);
    s.deleted_at = Some(Utc::now() - Duration::days(1));
    let missing = Uuid::now_v7();
    let trashed = insert_asset(&pool, s).await;
    for a in [trashed, missing] {
        assert_error(
            &post(&app.server, a, "x").await,
            StatusCode::NOT_FOUND,
            "asset.notFound",
        );
    }
    assert_error(
        &patch(&app.server, &missing.to_string(), "x").await,
        StatusCode::NOT_FOUND,
        "comment.notFound",
    );
}

#[sqlx::test]
async fn comment_count_on_asset(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let asset = insert_asset(&pool, AssetSeed::photo(app.user.id)).await;
    post_ok(&app.server, asset, "하나").await;
    let two = post_ok(&app.server, asset, "둘").await;
    delete(&app.server, two["id"].as_str().unwrap())
        .await
        .assert_status(StatusCode::NO_CONTENT);
    let detail: Value = app.server.get(&format!("/api/assets/{asset}")).await.json();
    assert_eq!(detail["comment_count"], 1);
}

#[sqlx::test]
async fn comments_require_auth(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let asset = insert_asset(&pool, AssetSeed::photo(app.user.id)).await;
    let anon = TestServer::new(build_router(app.state.clone())).unwrap();
    anon.get(&format!("/api/assets/{asset}/comments"))
        .await
        .assert_status(StatusCode::UNAUTHORIZED);
    post(&anon, asset, "x")
        .await
        .assert_status(StatusCode::UNAUTHORIZED);
    patch(&anon, &Uuid::now_v7().to_string(), "x")
        .await
        .assert_status(StatusCode::UNAUTHORIZED);
    delete(&anon, &Uuid::now_v7().to_string())
        .await
        .assert_status(StatusCode::UNAUTHORIZED);
}
