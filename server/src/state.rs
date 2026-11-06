use std::sync::Arc;

use sqlx::PgPool;

use crate::config::Config;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub config: Arc<Config>,
}

impl AppState {
    pub fn new(pool: PgPool, config: Config) -> AppState {
        AppState {
            pool,
            config: Arc::new(config),
        }
    }
}
