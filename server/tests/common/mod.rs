// 테스트 바이너리마다 쓰는 헬퍼가 달라 미사용 경고 허용.
#![allow(dead_code)]

use axum::http::{HeaderName, HeaderValue, StatusCode, header};
use axum_extra::extract::cookie::Cookie;
use axum_test::{TestResponse, TestServer};
use base64::{Engine, engine::general_purpose::STANDARD};
use chrono::{DateTime, Utc};
use littledays::{
    app::build_router,
    auth::{password, session},
    config::Config,
    media::storage,
    state::AppState,
    users::{self, NewUser, Role, User},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use std::path::PathBuf;
use tempfile::TempDir;
use uuid::Uuid;

pub const XRW: HeaderName = HeaderName::from_static("x-requested-with");
pub const XRW_VALUE: HeaderValue = HeaderValue::from_static("LittleDays");
pub const PASSWORD: &str = "password123";
pub const TUS_RESUMABLE: HeaderName = HeaderName::from_static("tus-resumable");
pub const TUS_VERSION: HeaderValue = HeaderValue::from_static("1.0.0");
pub const OFFSET_STREAM: &str = "application/offset+octet-stream";

pub fn test_config() -> Config {
    Config {
        database_url: String::new(),
        public_url: "http://localhost".to_string(),
        secret_key: (0u8..32).collect(),
        data_dir: PathBuf::from("./data"),
        port: 0,
        auto_migrate: false,
        worker_concurrency: 1,
    }
}

fn state(pool: PgPool) -> AppState {
    AppState::new(pool, test_config())
}

pub async fn test_server(pool: PgPool) -> TestServer {
    TestServer::builder()
        .save_cookies()
        .build(build_router(state(pool)))
        .expect("test server")
}

pub struct MediaApp {
    pub server: TestServer,
    pub state: AppState,
    pub user: User,
    /// 드롭 시 임시 `DATA_DIR` 삭제.
    pub data: TempDir,
}

/// 임시 `DATA_DIR` 를 쓰는 앱. `role` 사용자 생성 후 로그인한 쿠키 저장 서버.
/// 기본 사용자명이 "mom" 이라 `login_as` 에는 다른 이름 사용.
pub async fn media_app(pool: &PgPool, role: Role) -> MediaApp {
    let data = tempfile::tempdir().expect("tempdir");
    let mut config = test_config();
    config.data_dir = data.path().to_path_buf();
    storage::ensure_dirs(&config.data_dir).expect("ensure_dirs");
    let state = AppState::new(pool.clone(), config);
    let app = MediaApp {
        server: cookie_server(&state),
        user: create_user(pool, "mom", role).await,
        state,
        data,
    };
    login_user(&app.server, "mom").await;
    app
}

impl MediaApp {
    /// 같은 state·`DATA_DIR` 를 쓰는 다른 사용자 서버.
    pub async fn login_as(&self, username: &str, role: Role) -> (TestServer, User) {
        let user = create_user(&self.state.pool, username, role).await;
        let server = cookie_server(&self.state);
        login_user(&server, username).await;
        (server, user)
    }
}

/// `filename` 만 실은 tus 생성. 201 확인 후 업로드 id 반환.
pub async fn tus_create(app: &MediaApp, length: usize, filename: &str) -> Uuid {
    let res = app
        .server
        .post("/api/uploads")
        .add_header(XRW, XRW_VALUE)
        .add_header(TUS_RESUMABLE, TUS_VERSION)
        .add_header("upload-length", length.to_string())
        .add_header(
            "upload-metadata",
            format!("filename {}", STANDARD.encode(filename)),
        )
        .await;
    res.assert_status(StatusCode::CREATED);
    let location = res.header(header::LOCATION);
    let location = location.to_str().expect("location");
    location
        .strip_prefix("/api/uploads/")
        .expect("relative location")
        .parse()
        .expect("upload id")
}

pub async fn tus_patch(app: &MediaApp, id: Uuid, offset: usize, bytes: &[u8]) -> TestResponse {
    app.server
        .patch(&format!("/api/uploads/{id}"))
        .add_header(XRW, XRW_VALUE)
        .add_header(TUS_RESUMABLE, TUS_VERSION)
        .add_header("upload-offset", offset.to_string())
        .content_type(OFFSET_STREAM)
        .bytes(bytes.to_vec().into())
        .await
}

/// 생성 + PATCH 1회로 전체 바이트 업로드.
pub async fn upload_bytes(app: &MediaApp, bytes: &[u8], filename: &str) -> Uuid {
    let id = tus_create(app, bytes.len(), filename).await;
    tus_patch(app, id, 0, bytes)
        .await
        .assert_status(StatusCode::NO_CONTENT);
    id
}

/// 같은 state 로 실제 포트에 뜬 서버와 그 서버에서 `mom` 로그인한 `Cookie` 헤더 값.
/// 생 TCP 요청용.
pub async fn http_server(app: &MediaApp) -> (TestServer, String) {
    let server = TestServer::builder()
        .http_transport()
        .build(build_router(app.state.clone()))
        .expect("http test server");
    let res = server
        .post("/api/auth/login")
        .json(&json!({ "username": "mom", "password": PASSWORD }))
        .await;
    res.assert_status_ok();
    let cookie = res.cookie(session::COOKIE_NAME);
    let header = format!("{}={}", cookie.name(), cookie.value());
    (server, header)
}

fn cookie_server(state: &AppState) -> TestServer {
    TestServer::builder()
        .save_cookies()
        .build(build_router(state.clone()))
        .expect("test server")
}

async fn create_user(pool: &PgPool, username: &str, role: Role) -> User {
    users::queries::create(
        pool,
        NewUser {
            username: username.to_string(),
            password_hash: password::hash(PASSWORD).expect("hash"),
            display_name: username.to_string(),
            role,
            email: None,
            locale: "ko".to_string(),
        },
    )
    .await
    .expect("user")
}

async fn login_user(server: &TestServer, username: &str) {
    server
        .post("/api/auth/login")
        .json(&json!({ "username": username, "password": PASSWORD }))
        .await
        .assert_status_ok();
}

pub struct AssetSeed {
    pub id: Uuid,
    pub created_at: DateTime<Utc>,
    pub uploaded_by: Uuid,
    pub kind: &'static str,
    pub status: &'static str,
    pub taken_at: DateTime<Utc>,
    pub sha256: Vec<u8>,
    pub deleted_at: Option<DateTime<Utc>>,
    pub derivatives: Value,
    pub original_path: String,
    pub original_filename: String,
    pub mime: String,
}

impl AssetSeed {
    pub fn photo(uploaded_by: Uuid) -> AssetSeed {
        let id = Uuid::now_v7();
        let created_at = Utc::now();
        AssetSeed {
            id,
            created_at,
            uploaded_by,
            kind: "photo",
            status: "ready",
            taken_at: Utc::now(),
            sha256: rand::random::<[u8; 32]>().to_vec(),
            deleted_at: None,
            derivatives: json!({}),
            original_path: storage::original_rel_path(created_at, id, "jpg")
                .to_string_lossy()
                .into_owned(),
            original_filename: format!("{id}.jpg"),
            mime: "image/jpeg".to_string(),
        }
    }
}

/// 파일 없이 행만 삽입. 반환은 asset id.
pub async fn insert_asset(pool: &PgPool, seed: AssetSeed) -> Uuid {
    let id = seed.id;
    sqlx::query!(
        "INSERT INTO assets (id, kind, uploaded_by, original_path, original_filename, mime,
                             size_bytes, sha256, taken_at, taken_at_source, status, derivatives,
                             deleted_at, created_at)
         VALUES ($1, $2::text::asset_kind, $3, $4, $5, $6, 1, $7, $8, 'upload_time',
                 $9::text::asset_status, $10, $11, $12)",
        id,
        seed.kind,
        seed.uploaded_by,
        seed.original_path,
        seed.original_filename,
        seed.mime,
        seed.sha256,
        seed.taken_at,
        seed.status,
        seed.derivatives,
        seed.deleted_at,
        seed.created_at,
    )
    .execute(pool)
    .await
    .expect("insert asset");
    id
}

/// 쿠키 자동 저장 없음. 요청마다 인증 수단을 직접 지정.
pub async fn test_server_without_cookies(pool: PgPool) -> TestServer {
    TestServer::new(build_router(state(pool))).expect("test server")
}

/// 표준 에러 응답(`params` 빈 객체) 검사.
pub fn assert_error(res: &TestResponse, status: StatusCode, key: &str) {
    res.assert_status(status);
    res.assert_json(&json!({ "error": key, "params": {} }));
}

/// owner `mom` 가입 본문.
pub fn signup_body() -> Value {
    json!({
        "username": "mom",
        "password": PASSWORD,
        "display_name": "엄마",
        "instance_name": "우리집",
    })
}

pub fn login_body(password: &str) -> Value {
    json!({ "username": "mom", "password": password })
}

/// owner `mom` 가입. 세션 쿠키 반환.
pub async fn signup(server: &TestServer) -> Cookie<'static> {
    let res = server.post("/api/auth/signup").json(&signup_body()).await;
    res.assert_status(StatusCode::CREATED);
    res.cookie(session::COOKIE_NAME)
}

/// `mom` 로그인. 세션 쿠키 반환.
pub async fn login(server: &TestServer, user_agent: &str) -> Cookie<'static> {
    let res = server
        .post("/api/auth/login")
        .add_header(header::USER_AGENT, user_agent)
        .json(&login_body(PASSWORD))
        .await;
    res.assert_status_ok();
    res.cookie(session::COOKIE_NAME)
}

/// 지정 역할 사용자 직접 생성(비밀번호 `PASSWORD`) 후 로그인한 쿠키 저장 서버.
pub async fn server_as(pool: &PgPool, username: &str, role: Role) -> (TestServer, User) {
    let user = users::queries::create(
        pool,
        NewUser {
            username: username.to_string(),
            password_hash: password::hash(PASSWORD).expect("hash"),
            display_name: username.to_string(),
            role,
            email: None,
            locale: "ko".to_string(),
        },
    )
    .await
    .expect("user");
    let server = test_server(pool.clone()).await;
    server
        .post("/api/auth/login")
        .json(&json!({ "username": username, "password": PASSWORD }))
        .await
        .assert_status_ok();
    (server, user)
}
