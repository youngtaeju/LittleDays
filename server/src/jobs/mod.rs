//! Postgres 작업 큐.

use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgExecutor;
use uuid::Uuid;

use crate::error::AppResult;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Job {
    ProcessAsset { asset_id: Uuid },
}

#[derive(Deserialize)]
struct AssetPayload {
    asset_id: Uuid,
}

impl Job {
    /// `jobs.kind` 값.
    pub fn kind(&self) -> &'static str {
        match self {
            Job::ProcessAsset { .. } => "process_asset",
        }
    }

    /// `jobs.payload` 값.
    pub fn payload(&self) -> Value {
        match self {
            Job::ProcessAsset { asset_id } => json!({ "asset_id": asset_id }),
        }
    }

    pub fn parse(kind: &str, payload: Value) -> anyhow::Result<Job> {
        match kind {
            "process_asset" => {
                let p: AssetPayload = serde_json::from_value(payload)?;
                Ok(Job::ProcessAsset {
                    asset_id: p.asset_id,
                })
            }
            other => anyhow::bail!("unknown job kind: {other}"),
        }
    }
}

/// `queued` 로 즉시 실행 대상. 호출 측이 커밋 후 `AppState::jobs_wake.notify_one()`.
pub async fn enqueue(exec: impl PgExecutor<'_>, job: &Job) -> AppResult<Uuid> {
    let id = sqlx::query_scalar!(
        "INSERT INTO jobs (id, kind, payload) VALUES ($1, $2, $3) RETURNING id",
        Uuid::now_v7(),
        job.kind(),
        job.payload(),
    )
    .fetch_one(exec)
    .await?;
    Ok(id)
}

/// 자산 삭제 시 함께 지울 작업 행 (상태 무관).
pub async fn delete_for_asset(exec: impl PgExecutor<'_>, asset_id: Uuid) -> AppResult<()> {
    sqlx::query!(
        "DELETE FROM jobs WHERE payload ->> 'asset_id' = $1",
        asset_id.to_string()
    )
    .execute(exec)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn job_round_trip() {
        let job = Job::ProcessAsset {
            asset_id: Uuid::now_v7(),
        };
        assert_eq!(Job::parse(job.kind(), job.payload()).unwrap(), job);
        assert!(Job::parse("unknown", job.payload()).is_err());
        assert!(Job::parse("process_asset", json!({})).is_err());
    }
}
