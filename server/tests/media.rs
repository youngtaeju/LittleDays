mod common;

use axum::http::{StatusCode, header};
use axum_test::TestServer;
use common::{AssetSeed, MediaApp, XRW, XRW_VALUE, assert_error, insert_asset, media_app};
use littledays::{
    app::build_router,
    media::storage,
    users::{self, Role},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

const THUMB: &[u8] = b"fake-thumb-webp-bytes";
const ORIGINAL: &[u8] = b"0123456789abcdefghij-original";

fn write_original(app: &MediaApp, seed: &AssetSeed, bytes: &[u8]) {
    let path = app.data.path().join(&seed.original_path);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, bytes).unwrap();
}

fn write_derivative(app: &MediaApp, id: Uuid, file: &str, bytes: &[u8]) {
    let dir = storage::derivative_dir(app.data.path(), id);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join(file), bytes).unwrap();
}

fn variants() -> Value {
    json!({
        "thumb": {"width": 400, "height": 300, "formats": ["webp"]},
        "preview": {"width": 1600, "height": 1200, "formats": ["webp"]},
    })
}

/// 사진 자산 + thumb.webp 파일.
async fn photo_with_thumb(pool: &PgPool, app: &MediaApp) -> Uuid {
    let mut seed = AssetSeed::photo(app.user.id);
    seed.derivatives = variants();
    write_original(app, &seed, ORIGINAL);
    let id = insert_asset(pool, seed).await;
    write_derivative(app, id, "thumb.webp", THUMB);
    id
}

fn cookieless(app: &MediaApp) -> TestServer {
    TestServer::new(build_router(app.state.clone())).expect("test server")
}

async fn media_token(app: &MediaApp) -> String {
    let res = app
        .server
        .post("/api/auth/media-token")
        .add_header(XRW, XRW_VALUE)
        .await;
    res.assert_status_ok();
    res.json::<Value>()["token"].as_str().unwrap().to_string()
}

#[sqlx::test]
async fn thumb_with_cookie(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let id = photo_with_thumb(&pool, &app).await;
    let res = app
        .server
        .get(&format!("/api/assets/{id}/thumb.webp"))
        .await;
    res.assert_status_ok();
    assert_eq!(res.header(header::CONTENT_TYPE), "image/webp");
    assert_eq!(res.header(header::CACHE_CONTROL), "private, max-age=86400");
    assert_eq!(res.as_bytes().as_ref(), THUMB);
}

#[sqlx::test]
async fn thumb_with_media_token(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let id = photo_with_thumb(&pool, &app).await;
    let token = media_token(&app).await;
    let server = cookieless(&app);
    let url = format!("/api/assets/{id}/thumb.webp");

    let res = server.get(&url).add_query_param("t", &token).await;
    res.assert_status_ok();
    assert_eq!(res.as_bytes().as_ref(), THUMB);

    let res = server.get(&url).add_query_param("t", "garbage").await;
    assert_error(&res, StatusCode::UNAUTHORIZED, "auth.required");
    let res = server.get(&url).await;
    assert_error(&res, StatusCode::UNAUTHORIZED, "auth.required");
}

#[sqlx::test]
async fn disabled_user_token_rejected(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let id = photo_with_thumb(&pool, &app).await;
    let token = media_token(&app).await;
    users::queries::set_disabled(&pool, app.user.id, true)
        .await
        .unwrap();
    let res = cookieless(&app)
        .get(&format!("/api/assets/{id}/thumb.webp"))
        .add_query_param("t", &token)
        .await;
    assert_error(&res, StatusCode::UNAUTHORIZED, "auth.disabled");
}

#[sqlx::test]
async fn original_supports_range(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let id = photo_with_thumb(&pool, &app).await;
    let res = app
        .server
        .get(&format!("/api/assets/{id}/original"))
        .add_header(header::RANGE, "bytes=0-9")
        .await;
    res.assert_status(StatusCode::PARTIAL_CONTENT);
    assert_eq!(
        res.header(header::CONTENT_RANGE),
        format!("bytes 0-9/{}", ORIGINAL.len()).as_str()
    );
    assert_eq!(res.header(header::CONTENT_TYPE), "image/jpeg");
    assert_eq!(res.header(header::CACHE_CONTROL), "private, max-age=86400");
    assert_eq!(res.as_bytes().as_ref(), &ORIGINAL[..10]);
}

#[sqlx::test]
async fn original_filename_header(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let mut seed = AssetSeed::photo(app.user.id);
    seed.original_filename = "아기 \"첫\" 사진.heic".to_string();
    write_original(&app, &seed, ORIGINAL);
    let id = insert_asset(&pool, seed).await;
    let res = app.server.get(&format!("/api/assets/{id}/original")).await;
    res.assert_status_ok();
    let disposition = res.header(header::CONTENT_DISPOSITION);
    let disposition = disposition.to_str().unwrap();
    assert!(disposition.contains(
        "filename*=UTF-8''%EC%95%84%EA%B8%B0%20%22%EC%B2%AB%22%20%EC%82%AC%EC%A7%84.heic"
    ));
    let (ascii, _) = disposition.split_once("; filename*=").unwrap();
    assert_eq!(ascii, "attachment; filename=\"__ ___ __.heic\"");
    assert_eq!(ascii.matches('"').count(), 2);
}

#[sqlx::test]
async fn hostile_filenames_never_500(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    for name in ["", "   ", "a\r\nb\u{7f}.jpg", "\\\"/../x"] {
        let mut seed = AssetSeed::photo(app.user.id);
        seed.original_filename = name.to_string();
        write_original(&app, &seed, ORIGINAL);
        let id = insert_asset(&pool, seed).await;
        let res = app.server.get(&format!("/api/assets/{id}/original")).await;
        res.assert_status_ok();
        assert!(res.headers().contains_key(header::CONTENT_DISPOSITION));
        if name.trim().is_empty() {
            let d = res.header(header::CONTENT_DISPOSITION);
            assert!(d.to_str().unwrap().contains(&format!("{id}.jpg")));
        }
    }
}

#[sqlx::test]
async fn missing_variant_404(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let id = photo_with_thumb(&pool, &app).await;
    for file in [
        "preview.avif",
        "large.webp",
        "playback.mp4",
        "..%2Fx",
        "x.png",
    ] {
        let res = app.server.get(&format!("/api/assets/{id}/{file}")).await;
        assert_error(&res, StatusCode::NOT_FOUND, "asset.fileNotFound");
    }
    // 목록에는 있으나 파일이 없는 경우.
    let res = app
        .server
        .get(&format!("/api/assets/{id}/preview.webp"))
        .await;
    assert_error(&res, StatusCode::NOT_FOUND, "asset.fileNotFound");
}

#[sqlx::test]
async fn processing_asset_without_derivatives_404(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let mut seed = AssetSeed::photo(app.user.id);
    seed.status = "processing";
    let id = insert_asset(&pool, seed).await;
    let res = app
        .server
        .get(&format!("/api/assets/{id}/thumb.webp"))
        .await;
    assert_error(&res, StatusCode::NOT_FOUND, "asset.fileNotFound");
}

#[sqlx::test]
async fn get_retry_is_not_a_file(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let id = photo_with_thumb(&pool, &app).await;
    let res = app.server.get(&format!("/api/assets/{id}/retry")).await;
    res.assert_status(StatusCode::METHOD_NOT_ALLOWED);
}

#[sqlx::test]
async fn trash_visibility(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let mut seed = AssetSeed::photo(app.user.id);
    seed.derivatives = variants();
    seed.deleted_at = Some(chrono::Utc::now());
    let id = insert_asset(&pool, seed).await;
    write_derivative(&app, id, "thumb.webp", THUMB);
    let url = format!("/api/assets/{id}/thumb.webp");
    app.server.get(&url).await.assert_status_ok();
    let (family, _) = app.login_as("dad", Role::Family).await;
    assert_error(
        &family.get(&url).await,
        StatusCode::NOT_FOUND,
        "asset.notFound",
    );
}

#[sqlx::test]
async fn video_endpoint_prefers_playback(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;

    let mut with_playback = AssetSeed::photo(app.user.id);
    with_playback.kind = "video";
    with_playback.mime = "video/quicktime".to_string();
    with_playback.original_path = format!("originals/2026/11/{}.mov", with_playback.id);
    with_playback.derivatives =
        json!({"playback": {"width": 1280, "height": 720, "formats": ["mp4"]}});
    write_original(&app, &with_playback, b"original-mov");
    let id1 = insert_asset(&pool, with_playback).await;
    write_derivative(&app, id1, "playback.mp4", b"playback-mp4");
    let res = app.server.get(&format!("/api/assets/{id1}/video")).await;
    res.assert_status_ok();
    assert_eq!(res.as_bytes().as_ref(), b"playback-mp4");
    assert_eq!(res.header(header::CONTENT_TYPE), "video/mp4");

    let mut without = AssetSeed::photo(app.user.id);
    without.kind = "video";
    without.mime = "video/mp4".to_string();
    without.original_path = format!("originals/2026/11/{}.mp4", without.id);
    write_original(&app, &without, b"original-mp4");
    let id2 = insert_asset(&pool, without).await;
    let res = app.server.get(&format!("/api/assets/{id2}/video")).await;
    res.assert_status_ok();
    assert_eq!(res.as_bytes().as_ref(), b"original-mp4");
    assert!(!res.headers().contains_key(header::CONTENT_DISPOSITION));

    let photo = photo_with_thumb(&pool, &app).await;
    let res = app.server.get(&format!("/api/assets/{photo}/video")).await;
    assert_error(&res, StatusCode::NOT_FOUND, "asset.fileNotFound");
}

#[sqlx::test]
async fn processing_video_response_is_not_cached(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let mut seed = AssetSeed::photo(app.user.id);
    seed.kind = "video";
    seed.status = "processing";
    seed.mime = "video/mp4".to_string();
    seed.original_path = format!("originals/2026/11/{}.mp4", seed.id);
    write_original(&app, &seed, b"original-mp4");
    let id = insert_asset(&pool, seed).await;
    let res = app.server.get(&format!("/api/assets/{id}/video")).await;
    res.assert_status_ok();
    assert_eq!(res.header(header::CACHE_CONTROL), "no-store");
}
