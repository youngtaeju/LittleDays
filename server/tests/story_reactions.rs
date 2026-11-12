mod common;

use axum::http::StatusCode;
use axum_test::{TestResponse, TestServer};
use common::{XRW, XRW_VALUE, assert_error, media_app};
use littledays::users::Role;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

async fn story(server: &TestServer) -> Uuid {
    let res = server
        .post("/api/stories")
        .add_header(XRW, XRW_VALUE)
        .json(&json!({
            "entry_date": "2024-06-01",
            "body": "오늘의 이야기",
            "baby_ids": [],
            "asset_ids": [],
        }))
        .await;
    res.assert_status(StatusCode::CREATED);
    res.json::<Value>()["id"].as_str().unwrap().parse().unwrap()
}

async fn detail(server: &TestServer, id: Uuid) -> Value {
    server.get(&format!("/api/stories/{id}")).await.json()
}

async fn put_like(server: &TestServer, id: Uuid) -> TestResponse {
    server
        .put(&format!("/api/stories/{id}/like"))
        .add_header(XRW, XRW_VALUE)
        .await
}

async fn delete_like(server: &TestServer, id: Uuid) -> TestResponse {
    server
        .delete(&format!("/api/stories/{id}/like"))
        .add_header(XRW, XRW_VALUE)
        .await
}

async fn post(server: &TestServer, story: Uuid, body: &str) -> TestResponse {
    server
        .post(&format!("/api/stories/{story}/comments"))
        .add_header(XRW, XRW_VALUE)
        .json(&json!({ "body": body }))
        .await
}

async fn post_ok(server: &TestServer, story: Uuid, body: &str) -> Value {
    let res = post(server, story, body).await;
    res.assert_status(StatusCode::CREATED);
    res.json()
}

async fn patch(server: &TestServer, id: &str, body: &str) -> TestResponse {
    server
        .patch(&format!("/api/story-comments/{id}"))
        .add_header(XRW, XRW_VALUE)
        .json(&json!({ "body": body }))
        .await
}

async fn delete(server: &TestServer, id: &str) -> TestResponse {
    server
        .delete(&format!("/api/story-comments/{id}"))
        .add_header(XRW, XRW_VALUE)
        .await
}

#[sqlx::test]
async fn like_idempotent(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let id = story(&app.server).await;
    put_like(&app.server, id)
        .await
        .assert_status(StatusCode::NO_CONTENT);
    put_like(&app.server, id)
        .await
        .assert_status(StatusCode::NO_CONTENT);
    let likes: Value = app
        .server
        .get(&format!("/api/stories/{id}/likes"))
        .await
        .json();
    assert_eq!(likes.as_array().unwrap().len(), 1);
    assert_eq!(likes[0]["user_id"], app.user.id.to_string());

    delete_like(&app.server, id)
        .await
        .assert_status(StatusCode::NO_CONTENT);
    delete_like(&app.server, id)
        .await
        .assert_status(StatusCode::NO_CONTENT);
    let likes: Value = app
        .server
        .get(&format!("/api/stories/{id}/likes"))
        .await
        .json();
    assert!(likes.as_array().unwrap().is_empty());

    let missing = Uuid::now_v7();
    assert_error(
        &put_like(&app.server, missing).await,
        StatusCode::NOT_FOUND,
        "story.notFound",
    );
    assert_error(
        &delete_like(&app.server, missing).await,
        StatusCode::NOT_FOUND,
        "story.notFound",
    );
    assert_error(
        &app.server
            .get(&format!("/api/stories/{missing}/likes"))
            .await,
        StatusCode::NOT_FOUND,
        "story.notFound",
    );
}

#[sqlx::test]
async fn family_can_like_and_comment(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let (family, user) = app.login_as("aunt", Role::Family).await;
    let id = story(&app.server).await;
    put_like(&family, id)
        .await
        .assert_status(StatusCode::NO_CONTENT);
    let c = post_ok(&family, id, "  귀여워 ").await;
    assert_eq!(c["body"], "귀여워");
    assert_eq!(c["author_id"], user.id.to_string());
    assert_eq!(c["story_id"], id.to_string());
    assert!(c["edited_at"].is_null());

    let page: Value = family
        .get(&format!("/api/stories/{id}/comments"))
        .await
        .json();
    assert_eq!(page["items"].as_array().unwrap().len(), 1);

    assert_error(
        &post(&family, id, " ").await,
        StatusCode::BAD_REQUEST,
        "comment.bodyInvalid",
    );
    assert_error(
        &post(&family, id, &format!("<@{}>", Uuid::now_v7())).await,
        StatusCode::BAD_REQUEST,
        "comment.mentionInvalid",
    );
    assert_error(
        &post(&family, Uuid::now_v7(), "x").await,
        StatusCode::NOT_FOUND,
        "story.notFound",
    );
    assert_error(
        &family
            .get(&format!("/api/stories/{}/comments", Uuid::now_v7()))
            .await,
        StatusCode::NOT_FOUND,
        "story.notFound",
    );
}

#[sqlx::test]
async fn comments_page_oldest_first(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let id = story(&app.server).await;
    for body in ["a", "b", "c"] {
        post_ok(&app.server, id, body).await;
    }
    let url = format!("/api/stories/{id}/comments");
    let first: Value = app.server.get(&format!("{url}?limit=2")).await.json();
    let bodies = |p: &Value| -> Vec<String> {
        p["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| c["body"].as_str().unwrap().to_string())
            .collect()
    };
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
        assert_error(
            &app.server.get(&format!("{url}?{bad}")).await,
            StatusCode::BAD_REQUEST,
            "request.invalidQuery",
        );
    }
}

#[sqlx::test]
async fn comment_matrix(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let (guardian, _) = app.login_as("dad", Role::Guardian).await;
    let (family, _) = app.login_as("aunt", Role::Family).await;
    let id = story(&app.server).await;

    let theirs = post_ok(&app.server, id, "owner 글").await;
    let theirs = theirs["id"].as_str().unwrap();
    assert_error(
        &delete(&family, theirs).await,
        StatusCode::FORBIDDEN,
        "comment.forbidden",
    );
    delete(&guardian, theirs)
        .await
        .assert_status(StatusCode::NO_CONTENT);

    let mine = post_ok(&family, id, "family 글").await;
    delete(&app.server, mine["id"].as_str().unwrap())
        .await
        .assert_status(StatusCode::NO_CONTENT);

    let mine = post_ok(&family, id, "내 글").await;
    let mine = mine["id"].as_str().unwrap();
    delete(&family, mine)
        .await
        .assert_status(StatusCode::NO_CONTENT);
    assert_error(
        &delete(&family, mine).await,
        StatusCode::NOT_FOUND,
        "comment.notFound",
    );
}

#[sqlx::test]
async fn edit_own_only(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let (family, _) = app.login_as("aunt", Role::Family).await;
    let id = story(&app.server).await;
    let c = post_ok(&family, id, "처음").await;
    let cid = c["id"].as_str().unwrap();

    let edited = patch(&family, cid, " 고침 ").await;
    edited.assert_status_ok();
    let edited: Value = edited.json();
    assert_eq!(edited["body"], "고침");
    assert!(!edited["edited_at"].is_null());

    assert_error(
        &patch(&app.server, cid, "남의 글").await,
        StatusCode::FORBIDDEN,
        "comment.forbidden",
    );
    assert_error(
        &patch(&family, cid, " ").await,
        StatusCode::BAD_REQUEST,
        "comment.bodyInvalid",
    );
    assert_error(
        &patch(&family, &Uuid::now_v7().to_string(), "x").await,
        StatusCode::NOT_FOUND,
        "comment.notFound",
    );
}

#[sqlx::test]
async fn counts_on_story(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let (family, _) = app.login_as("aunt", Role::Family).await;
    let id = story(&app.server).await;
    let s = detail(&app.server, id).await;
    assert_eq!(s["like_count"], 0);
    assert_eq!(s["comment_count"], 0);
    assert_eq!(s["liked"], false);

    put_like(&app.server, id).await;
    put_like(&family, id).await;
    post_ok(&family, id, "하나").await;
    let s = detail(&app.server, id).await;
    assert_eq!(s["like_count"], 2);
    assert_eq!(s["comment_count"], 1);
    assert_eq!(s["liked"], true);
    let by_other = detail(&family, id).await;
    assert_eq!(by_other["liked"], true);
    delete_like(&family, id).await;
    assert_eq!(detail(&family, id).await["liked"], false);
}

#[sqlx::test]
async fn story_delete_cascades_reactions(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let id = story(&app.server).await;
    put_like(&app.server, id).await;
    let c = post_ok(&app.server, id, "글").await;
    app.server
        .delete(&format!("/api/stories/{id}"))
        .add_header(XRW, XRW_VALUE)
        .await
        .assert_status(StatusCode::NO_CONTENT);

    let likes = sqlx::query_scalar!("SELECT count(*) FROM story_likes WHERE story_id = $1", id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let comments = sqlx::query_scalar!(
        "SELECT count(*) FROM story_comments WHERE story_id = $1",
        id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!((likes, comments), (Some(0), Some(0)));
    assert_error(
        &patch(&app.server, c["id"].as_str().unwrap(), "x").await,
        StatusCode::NOT_FOUND,
        "comment.notFound",
    );
}

#[sqlx::test]
async fn story_reactions_require_csrf(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let id = story(&app.server).await;
    app.server
        .put(&format!("/api/stories/{id}/like"))
        .await
        .assert_status(StatusCode::FORBIDDEN);
    app.server
        .post(&format!("/api/stories/{id}/comments"))
        .json(&json!({ "body": "x" }))
        .await
        .assert_status(StatusCode::FORBIDDEN);
    let c = post_ok(&app.server, id, "x").await;
    let cid = c["id"].as_str().unwrap();
    app.server
        .patch(&format!("/api/story-comments/{cid}"))
        .json(&json!({ "body": "y" }))
        .await
        .assert_status(StatusCode::FORBIDDEN);
    app.server
        .delete(&format!("/api/story-comments/{cid}"))
        .await
        .assert_status(StatusCode::FORBIDDEN);
}
