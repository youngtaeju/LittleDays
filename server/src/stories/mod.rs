//! 이야기. 날짜에 붙는 일기. 사진은 기존 사진 연결만, 휴지통 사진은 응답에서 제외.

use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    assets::AssetSummary,
    auth::extract::CurrentUser,
    error::{AppError, AppResult},
    users::Role,
};

pub mod queries;
pub mod routes;

const MAX_BODY_CHARS: usize = 5000;

/// 하루 목록용 이야기.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct StorySummary {
    pub id: Uuid,
    pub author_id: Uuid,
    pub entry_date: NaiveDate,
    pub body: String,
    pub created_at: DateTime<Utc>,
    /// 고친 적 없으면 `null`.
    #[schema(required = true)]
    pub edited_at: Option<DateTime<Utc>>,
    /// 아기 표시 순서.
    pub baby_ids: Vec<Uuid>,
    /// 붙인 순서 앞 4장. 휴지통 제외.
    pub previews: Vec<AssetSummary>,
    /// 휴지통 제외.
    pub asset_count: i64,
    pub like_count: i64,
    pub comment_count: i64,
}

/// 이야기 상세.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct Story {
    #[serde(flatten)]
    pub summary: StorySummary,
    /// 붙인 순서 전부. 휴지통 제외.
    pub assets: Vec<AssetSummary>,
    /// 요청자의 하트 여부.
    pub liked: bool,
}

// 하트 누른 사람은 사진과 같은 `Like` 모양.
pub use crate::reactions::Like;

/// 이야기 댓글. 사진 댓글과 같은 모양.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct StoryComment {
    pub id: Uuid,
    pub story_id: Uuid,
    pub author_id: Uuid,
    pub body: String,
    pub created_at: DateTime<Utc>,
    /// 고친 적 없으면 `null`.
    #[schema(required = true)]
    pub edited_at: Option<DateTime<Utc>>,
}

/// 작성자이고 guardian 이상.
pub fn can_edit(current: &CurrentUser, story_author: Uuid) -> bool {
    current.user.id == story_author && can_write(current)
}

fn can_write(current: &CurrentUser) -> bool {
    matches!(current.user.role, Role::Owner | Role::Guardian)
}

/// 앞뒤 공백 제거 후 1~5000자(유니코드 문자 수)가 아니면 400 `story.bodyInvalid`.
fn normalize_body(raw: &str) -> AppResult<&str> {
    let body = raw.trim();
    if body.is_empty() || body.chars().count() > MAX_BODY_CHARS {
        return Err(AppError::bad_request("story.bodyInvalid"));
    }
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn body_normalized() {
        assert_eq!(normalize_body(" a\n").unwrap(), "a");
        assert!(normalize_body(" ").is_err());
        assert!(normalize_body(&"가".repeat(5001)).is_err());
    }
}
