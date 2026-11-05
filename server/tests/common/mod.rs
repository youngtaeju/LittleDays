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

pub async fn test_server(pool: PgPool) -> TestServer {
    let state = AppState {
        pool,
        config: Arc::new(test_config()),
    };
    TestServer::builder()
        .save_cookies()
        .build(build_router(state))
        .expect("test server")
}
