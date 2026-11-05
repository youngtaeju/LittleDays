// 테스트 바이너리마다 쓰는 헬퍼가 달라 미사용 경고 허용.
#![allow(dead_code)]

use axum::http::{HeaderName, HeaderValue, StatusCode, header};
use axum_extra::extract::cookie::Cookie;
use axum_test::{TestResponse, TestServer};
use littledays::{
    app::build_router,
    auth::{password, session},
    config::Config,
    state::AppState,
    users::{self, NewUser, Role, User},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use std::{path::PathBuf, sync::Arc};

pub const XRW: HeaderName = HeaderName::from_static("x-requested-with");
pub const XRW_VALUE: HeaderValue = HeaderValue::from_static("LittleDays");
pub const PASSWORD: &str = "password123";

pub fn test_config() -> Config {
    Config {
        database_url: String::new(),
        public_url: "http://localhost".to_string(),
        secret_key: (0u8..32).collect(),
        data_dir: PathBuf::from("./data"),
        port: 0,
        auto_migrate: false,
    }
}

fn state(pool: PgPool) -> AppState {
    AppState {
        pool,
        config: Arc::new(test_config()),
    }
}

pub async fn test_server(pool: PgPool) -> TestServer {
    TestServer::builder()
        .save_cookies()
        .build(build_router(state(pool)))
        .expect("test server")
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
