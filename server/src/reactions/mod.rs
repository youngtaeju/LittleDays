//! 사진 반응(하트, 즐겨찾기, 댓글). 휴지통 사진의 반응은 역할과 무관하게 404.

use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::PgExecutor;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::error::{AppError, AppResult};

pub mod queries;
pub mod routes;

/// 하트 누른 사람.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct Like {
    pub user_id: Uuid,
    pub created_at: DateTime<Utc>,
}

/// 없거나 휴지통이면 404 `asset.notFound`.
/// 트랜잭션 안에서 호출 시 커밋까지 완전 삭제 차단(반응 쓰기의 FK 위반 방지).
pub async fn require_visible(exec: impl PgExecutor<'_>, asset_id: Uuid) -> AppResult<()> {
    sqlx::query_scalar!(
        "SELECT id FROM assets WHERE id = $1 AND deleted_at IS NULL FOR KEY SHARE",
        asset_id
    )
    .fetch_optional(exec)
    .await?
    .map(|_| ())
    .ok_or(AppError::NotFound("asset.notFound"))
}
