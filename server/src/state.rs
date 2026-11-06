use std::{sync::Arc, time::Duration};

use sqlx::PgPool;
use tokio::sync::Notify;

use crate::{
    config::Config,
    uploads::{UPLOAD_IDLE_TIMEOUT, locks::UploadLocks},
};

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub config: Arc<Config>,
    pub upload_locks: Arc<UploadLocks>,
    /// PATCH 본문 무수신 한도. 기본 `UPLOAD_IDLE_TIMEOUT`, 테스트에서 단축.
    pub upload_idle_timeout: Duration,
    /// 작업 enqueue 커밋 후 `notify_one`. 대기 중 워커 즉시 깨움.
    pub jobs_wake: Arc<Notify>,
}

impl AppState {
    pub fn new(pool: PgPool, config: Config) -> AppState {
        AppState {
            pool,
            config: Arc::new(config),
            upload_locks: Arc::new(UploadLocks::default()),
            upload_idle_timeout: UPLOAD_IDLE_TIMEOUT,
            jobs_wake: Arc::new(Notify::new()),
        }
    }
}
