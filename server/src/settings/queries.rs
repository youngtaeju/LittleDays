use serde::de::DeserializeOwned;
use serde_json::Value;
use sqlx::PgExecutor;

use super::Settings;
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

pub async fn remove(exec: impl PgExecutor<'_>, key: &str) -> AppResult<()> {
    sqlx::query!("DELETE FROM settings WHERE key = $1", key)
        .execute(exec)
        .await?;
    Ok(())
}

/// 전체 키 1회 조회. 미저장 키와 형식 불일치 값은 기본값.
pub async fn load(exec: impl PgExecutor<'_>) -> AppResult<Settings> {
    let rows = sqlx::query!("SELECT key, value FROM settings")
        .fetch_all(exec)
        .await?;
    let mut settings = Settings::default();
    for row in rows {
        match row.key.as_str() {
            "instance_name" => assign(&mut settings.instance_name, &row.key, row.value),
            "timezone" => assign(&mut settings.timezone, &row.key, row.value),
            "default_locale" => assign(&mut settings.default_locale, &row.key, row.value),
            "derivatives_avif" => assign(&mut settings.derivatives_avif, &row.key, row.value),
            "trash_retention_days" => {
                assign(&mut settings.trash_retention_days, &row.key, row.value)
            }
            "primary_baby_id" => assign(&mut settings.primary_baby_id, &row.key, row.value),
            _ => {}
        }
    }
    Ok(settings)
}

/// 형식 불일치 시 경고 후 기존(기본) 값 유지.
fn assign<T: DeserializeOwned>(slot: &mut T, key: &str, value: Value) {
    match serde_json::from_value(value) {
        Ok(v) => *slot = v,
        Err(e) => tracing::warn!(key, error = %e, "settings value type mismatch, using default"),
    }
}

/// Postgres 시간대 DB 기준 IANA 이름 존재 여부.
pub async fn timezone_exists(exec: impl PgExecutor<'_>, name: &str) -> AppResult<bool> {
    let exists = sqlx::query_scalar!(
        r#"SELECT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name = $1) AS "exists!""#,
        name,
    )
    .fetch_one(exec)
    .await?;
    Ok(exists)
}
