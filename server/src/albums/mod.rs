//! 앨범. 사진/영상 묶음, 중첩 없음. 휴지통 사진 연결은 응답에서 제외하되 복원 대비 유지.

use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use sqlx::PgConnection;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    assets::AssetSummary,
    auth::extract::CurrentUser,
    error::{AppError, AppResult},
    links,
    users::Role,
};

pub mod queries;
pub mod routes;

/// 한 번에 넣고 빼는 사진 수 상한.
pub const MAX_ASSETS: usize = 500;
const MAX_NAME_CHARS: usize = 50;

/// 앨범 목록/상세.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AlbumSummary {
    pub id: Uuid,
    pub name: String,
    /// 지정 표지가 앨범 안의 휴지통 아닌 처리 완료 사진이면 그것, 아니면 촬영 오래된 순 첫 처리 완료 사진. 없으면 `null`.
    #[schema(required = true)]
    pub cover: Option<AssetSummary>,
    /// 휴지통 제외. 처리 중, 실패 포함.
    pub photo_count: i64,
    /// 휴지통 제외. 처리 중, 실패 포함.
    pub video_count: i64,
    /// 인스턴스 시간대 기준 가장 이른 촬영일. 비면 `null`.
    #[schema(required = true)]
    pub from: Option<NaiveDate>,
    /// 인스턴스 시간대 기준 가장 늦은 촬영일. 비면 `null`.
    #[schema(required = true)]
    pub to: Option<NaiveDate>,
    pub created_by: Uuid,
    pub created_at: DateTime<Utc>,
    /// 이름, 표지, 사진 넣기/빼기 시각.
    pub updated_at: DateTime<Utc>,
}

/// guardian 이상 아니면 403 `album.forbidden`.
fn require_write(current: &CurrentUser) -> AppResult<()> {
    current
        .require(Role::Guardian)
        .map_err(|_| AppError::Forbidden("album.forbidden"))
}

/// 앞뒤 공백 제거 후 1~50자(유니코드 문자 수)가 아니면 400 `album.nameInvalid`.
fn normalize_name(raw: &str) -> AppResult<&str> {
    let name = raw.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME_CHARS {
        return Err(AppError::bad_request("album.nameInvalid"));
    }
    Ok(name)
}

/// 1~500개가 아니면 400 `request.invalidBody`.
fn check_count(ids: &[Uuid]) -> AppResult<()> {
    if !(1..=MAX_ASSETS).contains(&ids.len()) {
        return Err(AppError::bad_request("request.invalidBody"));
    }
    Ok(())
}

/// 중복 제거한 넣을 사진 목록. 개수 오류 400 `request.invalidBody`, 없거나 휴지통이면 404 `asset.notFound`.
/// 트랜잭션 안에서 호출 시 커밋까지 사진 완전 삭제 차단.
pub async fn check_assets(conn: &mut PgConnection, ids: &[Uuid]) -> AppResult<Vec<Uuid>> {
    check_count(ids)?;
    let mut ids = links::dedup(ids);
    // 동시 겹치는 추가가 같은 순서로 잠그도록 정렬. 앨범 순서는 촬영 시각이라 무관.
    ids.sort_unstable();
    if links::lock_visible_assets(conn, &ids).await? != ids.len() {
        return Err(AppError::NotFound("asset.notFound"));
    }
    Ok(ids)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn name_normalized() {
        assert_eq!(normalize_name(" 봄 \n").unwrap(), "봄");
        assert!(normalize_name(" ").is_err());
        assert!(normalize_name(&"가".repeat(50)).is_ok());
        assert!(normalize_name(&"가".repeat(51)).is_err());
    }
}
