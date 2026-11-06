mod common;

use std::time::Duration;

use axum::http::{Method, StatusCode, header};
use axum_test::{TestRequest, TestResponse, TestServer};
use base64::{Engine, engine::general_purpose::STANDARD};
use common::{
    MediaApp, OFFSET_STREAM, TUS_RESUMABLE, TUS_VERSION, XRW, XRW_VALUE, assert_error, http_server,
    media_app, tus_create, tus_patch,
};
use littledays::{maintenance, media::storage, users::Role};
use serde_json::Value;
use sqlx::PgPool;
use tokio::{io::AsyncWriteExt, net::TcpStream, time::Instant};
use uuid::Uuid;

fn path(id: Uuid) -> String {
    format!("/api/uploads/{id}")
}

fn create_req(server: &TestServer, length: &str) -> TestRequest {
    server
        .post("/api/uploads")
        .add_header(XRW, XRW_VALUE)
        .add_header(TUS_RESUMABLE, TUS_VERSION)
        .add_header("upload-length", length)
}

fn metadata(pairs: &[(&str, &str)]) -> String {
    pairs
        .iter()
        .map(|(k, v)| format!("{k} {}", STANDARD.encode(v)))
        .collect::<Vec<_>>()
        .join(",")
}

async fn head(server: &TestServer, id: Uuid) -> TestResponse {
    server
        .method(Method::HEAD, &path(id))
        .add_header(TUS_RESUMABLE, TUS_VERSION)
        .await
}

fn header_str(res: &TestResponse, name: &str) -> String {
    res.header(name).to_str().expect("header").to_string()
}

fn temp_file(app: &MediaApp, id: Uuid) -> std::path::PathBuf {
    storage::upload_temp_path(app.data.path(), id)
}

/// 생 TCP 테스트의 폴링·재시도 한도.
fn deadline() -> Instant {
    Instant::now() + Duration::from_secs(2)
}

/// HEAD 의 `Upload-Offset` 이 `want` 가 될 때까지 `deadline` 까지 폴링.
async fn wait_offset(app: &MediaApp, id: Uuid, want: u64, deadline: Instant) {
    loop {
        let res = head(&app.server, id).await;
        res.assert_status_ok();
        let offset: u64 = header_str(&res, "upload-offset").parse().expect("offset");
        if offset == want {
            return;
        }
        assert!(Instant::now() < deadline, "offset {offset}, 기대 {want}");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

/// 이어올리기 PATCH. tus-js-client 처럼 409 `upload.locked`(앞 PATCH 의 fsync·락 해제 전) 동안 `deadline` 까지 재시도.
async fn resume_patch(
    app: &MediaApp,
    id: Uuid,
    offset: usize,
    bytes: &[u8],
    deadline: Instant,
) -> TestResponse {
    loop {
        let res = tus_patch(app, id, offset, bytes).await;
        let locked = res.status_code() == StatusCode::CONFLICT
            && res.json::<Value>()["error"] == "upload.locked";
        if !locked || Instant::now() >= deadline {
            return res;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

/// `Content-Length: total` PATCH 헤더와 본문 일부만 보낸 열린 소켓.
async fn partial_patch(
    app: &MediaApp,
    id: Uuid,
    total: usize,
    sent: &[u8],
) -> (TestServer, TcpStream) {
    let (server, cookie) = http_server(app).await;
    let url = server.server_address().expect("address");
    let addr = format!(
        "{}:{}",
        url.host_str().expect("host"),
        url.port().expect("port")
    );
    let mut stream = TcpStream::connect(&addr).await.expect("connect");
    let head = format!(
        "PATCH {} HTTP/1.1\r\nHost: {addr}\r\nCookie: {cookie}\r\nX-Requested-With: LittleDays\r\n\
         Tus-Resumable: 1.0.0\r\nUpload-Offset: 0\r\nContent-Type: {OFFSET_STREAM}\r\n\
         Content-Length: {total}\r\n\r\n",
        path(id)
    );
    stream.write_all(head.as_bytes()).await.expect("write head");
    stream.write_all(sent).await.expect("write body");
    stream.flush().await.expect("flush");
    (server, stream)
}

#[sqlx::test]
async fn options_advertises_extensions(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let server = TestServer::new(littledays::app::build_router(app.state.clone())).unwrap();

    let res = server.method(Method::OPTIONS, "/api/uploads").await;

    res.assert_status(StatusCode::NO_CONTENT);
    assert_eq!(header_str(&res, "tus-version"), "1.0.0");
    assert_eq!(
        header_str(&res, "tus-extension"),
        "creation,termination,expiration"
    );
    assert_eq!(header_str(&res, "tus-max-size"), "8589934592");
    assert_eq!(header_str(&res, "tus-resumable"), "1.0.0");
}

#[sqlx::test]
async fn family_cannot_create(pool: PgPool) {
    let app = media_app(&pool, Role::Family).await;

    let res = create_req(&app.server, "10")
        .add_header("upload-metadata", metadata(&[("filename", "a.jpg")]))
        .await;

    assert_error(&res, StatusCode::FORBIDDEN, "auth.forbidden");
}

#[sqlx::test]
async fn create_requires_tus_headers(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let meta = metadata(&[("filename", "a.jpg")]);

    let res = app
        .server
        .post("/api/uploads")
        .add_header(XRW, XRW_VALUE)
        .add_header("upload-length", "10")
        .add_header("upload-metadata", meta.clone())
        .await;
    assert_error(&res, StatusCode::PRECONDITION_FAILED, "upload.tusVersion");
    assert_eq!(header_str(&res, "tus-version"), "1.0.0");

    let res = app
        .server
        .post("/api/uploads")
        .add_header(XRW, XRW_VALUE)
        .add_header(TUS_RESUMABLE, TUS_VERSION)
        .add_header("upload-defer-length", "1")
        .add_header("upload-metadata", meta.clone())
        .await;
    assert_error(&res, StatusCode::BAD_REQUEST, "upload.deferNotSupported");

    let res = create_req(&app.server, "abc")
        .add_header("upload-metadata", meta.clone())
        .await;
    assert_error(&res, StatusCode::BAD_REQUEST, "upload.lengthInvalid");

    let res = create_req(&app.server, "8589934593")
        .add_header("upload-metadata", meta.clone())
        .await;
    assert_error(&res, StatusCode::PAYLOAD_TOO_LARGE, "upload.tooLarge");

    let res = create_req(&app.server, "10")
        .add_header("upload-metadata", metadata(&[("filetype", "image/jpeg")]))
        .await;
    assert_error(&res, StatusCode::BAD_REQUEST, "upload.filenameRequired");

    let res = create_req(&app.server, "10")
        .add_header("upload-metadata", "filename !!!not-base64")
        .await;
    assert_error(&res, StatusCode::BAD_REQUEST, "upload.metadataInvalid");

    let rows = sqlx::query_scalar!("SELECT count(*) FROM uploads")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(rows, Some(0));
}

#[sqlx::test]
async fn create_returns_relative_location(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;

    let res = create_req(&app.server, "10")
        .add_header(
            "upload-metadata",
            format!(
                "{},flag",
                metadata(&[("filename", "아기.heic"), ("filetype", "image/heic")])
            ),
        )
        .await;

    res.assert_status(StatusCode::CREATED);
    assert_eq!(header_str(&res, "tus-resumable"), "1.0.0");
    assert!(res.maybe_header("upload-expires").is_some());
    let location = header_str(&res, header::LOCATION.as_str());
    let id: Uuid = location
        .strip_prefix("/api/uploads/")
        .expect("relative")
        .parse()
        .unwrap();

    let res = head(&app.server, id).await;
    res.assert_status_ok();
    assert_eq!(header_str(&res, "upload-offset"), "0");
    assert_eq!(header_str(&res, "upload-length"), "10");
    assert_eq!(header_str(&res, "cache-control"), "no-store");
    assert!(header_str(&res, "upload-expires").ends_with(" GMT"));
    assert!(temp_file(&app, id).is_file());

    let meta = sqlx::query_scalar!("SELECT metadata FROM uploads WHERE id = $1", id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        meta,
        serde_json::json!({ "filename": "아기.heic", "filetype": "image/heic", "flag": "" })
    );
}

#[sqlx::test]
async fn chunked_upload_reaches_length(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let bytes = b"0123456789";
    let id = tus_create(&app, bytes.len(), "a.jpg").await;

    let res = tus_patch(&app, id, 0, &bytes[..4]).await;
    res.assert_status(StatusCode::NO_CONTENT);
    assert_eq!(header_str(&res, "upload-offset"), "4");
    assert!(res.maybe_header("upload-expires").is_some());
    let res = tus_patch(&app, id, 4, &bytes[4..]).await;
    res.assert_status(StatusCode::NO_CONTENT);
    assert_eq!(header_str(&res, "upload-offset"), "10");

    let res = head(&app.server, id).await;
    assert_eq!(header_str(&res, "upload-offset"), "10");
    assert_eq!(std::fs::read(temp_file(&app, id)).unwrap(), bytes);
}

#[sqlx::test]
async fn patch_rejects_wrong_offset_and_type(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let id = tus_create(&app, 10, "a.jpg").await;

    let res = tus_patch(&app, id, 3, b"abc").await;
    assert_error(&res, StatusCode::CONFLICT, "upload.offsetMismatch");

    let res = app
        .server
        .patch(&path(id))
        .add_header(XRW, XRW_VALUE)
        .add_header(TUS_RESUMABLE, TUS_VERSION)
        .add_header("upload-offset", "0")
        .content_type("application/octet-stream")
        .bytes(b"abc".to_vec().into())
        .await;
    assert_error(
        &res,
        StatusCode::UNSUPPORTED_MEDIA_TYPE,
        "upload.contentType",
    );

    let res = tus_patch(&app, id, 0, &[7u8; 11]).await;
    assert_error(&res, StatusCode::PAYLOAD_TOO_LARGE, "upload.tooLarge");

    let res = head(&app.server, id).await;
    assert_eq!(header_str(&res, "upload-offset"), "0");
}

#[sqlx::test]
async fn patch_without_csrf_header_rejected(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let id = tus_create(&app, 10, "a.jpg").await;

    let res = app
        .server
        .patch(&path(id))
        .add_header(TUS_RESUMABLE, TUS_VERSION)
        .add_header("upload-offset", "0")
        .content_type(OFFSET_STREAM)
        .bytes(b"abc".to_vec().into())
        .await;

    assert_error(&res, StatusCode::FORBIDDEN, "auth.csrf");
}

#[sqlx::test]
async fn other_user_cannot_see_upload(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let id = tus_create(&app, 10, "a.jpg").await;
    let (other, _) = app.login_as("dad", Role::Guardian).await;

    let res = head(&other, id).await;
    res.assert_status(StatusCode::NOT_FOUND);
    let res = other
        .patch(&path(id))
        .add_header(XRW, XRW_VALUE)
        .add_header(TUS_RESUMABLE, TUS_VERSION)
        .add_header("upload-offset", "0")
        .content_type(OFFSET_STREAM)
        .bytes(b"abc".to_vec().into())
        .await;
    assert_error(&res, StatusCode::NOT_FOUND, "upload.notFound");
    let res = other
        .delete(&path(id))
        .add_header(XRW, XRW_VALUE)
        .add_header(TUS_RESUMABLE, TUS_VERSION)
        .await;
    assert_error(&res, StatusCode::NOT_FOUND, "upload.notFound");

    head(&app.server, id).await.assert_status_ok();
    assert!(temp_file(&app, id).is_file());
}

#[sqlx::test]
async fn delete_terminates(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let id = tus_create(&app, 10, "a.jpg").await;
    tus_patch(&app, id, 0, b"abc")
        .await
        .assert_status(StatusCode::NO_CONTENT);

    let res = app
        .server
        .delete(&path(id))
        .add_header(XRW, XRW_VALUE)
        .add_header(TUS_RESUMABLE, TUS_VERSION)
        .await;
    res.assert_status(StatusCode::NO_CONTENT);
    assert_eq!(header_str(&res, "tus-resumable"), "1.0.0");

    head(&app.server, id)
        .await
        .assert_status(StatusCode::NOT_FOUND);
    assert!(!temp_file(&app, id).exists());
}

#[sqlx::test]
async fn expired_upload_is_gone_and_cleaned(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let id = tus_create(&app, 10, "a.jpg").await;
    let live = tus_create(&app, 10, "b.jpg").await;
    sqlx::query!(
        "UPDATE uploads SET expires_at = now() - interval '1 minute' WHERE id = $1",
        id
    )
    .execute(&pool)
    .await
    .unwrap();

    head(&app.server, id)
        .await
        .assert_status(StatusCode::NOT_FOUND);

    maintenance::run_once(&app.state).await.expect("run_once");

    let ids = sqlx::query_scalar!("SELECT id FROM uploads")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(ids, vec![live]);
    assert!(!temp_file(&app, id).exists());
    assert!(temp_file(&app, live).is_file());
}

#[sqlx::test]
async fn dropped_connection_keeps_partial_bytes(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let bytes: Vec<u8> = (0..1000u32).map(|i| (i % 251) as u8).collect();
    let id = tus_create(&app, bytes.len(), "a.mp4").await;

    let (_server, stream) = partial_patch(&app, id, bytes.len(), &bytes[..400]).await;
    drop(stream);
    let deadline = deadline();
    wait_offset(&app, id, 400, deadline).await;

    let res = resume_patch(&app, id, 400, &bytes[400..], deadline).await;
    res.assert_status(StatusCode::NO_CONTENT);
    assert_eq!(header_str(&res, "upload-offset"), "1000");
    assert_eq!(std::fs::read(temp_file(&app, id)).unwrap(), bytes);
}

#[sqlx::test]
async fn stalled_connection_releases_lock_after_idle_timeout(pool: PgPool) {
    let mut app = media_app(&pool, Role::Guardian).await;
    app.state.upload_idle_timeout = Duration::from_millis(300);
    let bytes: Vec<u8> = (0..1000u32).map(|i| (i % 251) as u8).collect();
    let id = tus_create(&app, bytes.len(), "a.mp4").await;

    // 본문 일부만 보내고 쓰기도 닫기도 안 함 (FIN/RST 없는 반개방 연결 흉내).
    let (_server, stream) = partial_patch(&app, id, bytes.len(), &bytes[..400]).await;
    let deadline = deadline();
    wait_offset(&app, id, 400, deadline).await;

    let res = resume_patch(&app, id, 400, &bytes[400..], deadline).await;
    res.assert_status(StatusCode::NO_CONTENT);
    assert_eq!(header_str(&res, "upload-offset"), "1000");
    assert_eq!(std::fs::read(temp_file(&app, id)).unwrap(), bytes);

    drop(stream);
}

#[sqlx::test]
async fn concurrent_patch_is_locked(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let id = tus_create(&app, 1000, "a.mp4").await;

    let (_server, stream) = partial_patch(&app, id, 1000, &[1u8; 100]).await;
    wait_offset(&app, id, 100, deadline()).await;

    let res = tus_patch(&app, id, 100, &[2u8; 10]).await;
    assert_error(&res, StatusCode::CONFLICT, "upload.locked");
    let res = app
        .server
        .delete(&path(id))
        .add_header(XRW, XRW_VALUE)
        .add_header(TUS_RESUMABLE, TUS_VERSION)
        .await;
    assert_error(&res, StatusCode::CONFLICT, "upload.locked");

    drop(stream);
}
