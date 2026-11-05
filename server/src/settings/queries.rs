use serde_json::Value;
use sqlx::PgExecutor;

use crate::error::AppResult;

pub async fn set(exec: impl PgExecutor<'_>, key: &str, value: Value) -> AppResult<()> {
    sqlx::query!(
        "INSERT INTO settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
        key,
        value,
    )
    .execute(exec)
    .await?;
    Ok(())
}

pub async fn get(exec: impl PgExecutor<'_>, key: &str) -> AppResult<Option<Value>> {
    let value = sqlx::query_scalar!("SELECT value FROM settings WHERE key = $1", key)
        .fetch_optional(exec)
        .await?;
    Ok(value)
}
