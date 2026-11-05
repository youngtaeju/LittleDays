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
