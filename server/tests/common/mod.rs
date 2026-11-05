// 테스트 바이너리마다 쓰는 헬퍼가 달라 미사용 경고 허용.
#![allow(dead_code)]

use axum_test::TestServer;
use littledays::{app::build_router, config::Config, state::AppState};
use sqlx::PgPool;
use std::{path::PathBuf, sync::Arc};

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
