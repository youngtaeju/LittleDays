//! 사진 댓글. 휴지통 사진의 댓글은 읽기와 쓰기 모두 막음.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgExecutor;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::{
    assets::{Page, cursor},
    auth::extract::CurrentUser,
    error::{AppError, AppResult},
    users::Role,
};

pub mod queries;
pub mod routes;

const MAX_BODY_CHARS: usize = 1000;

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct Comment {
    pub id: Uuid,
    pub asset_id: Uuid,
    pub author_id: Uuid,
    pub body: String,
    pub created_at: DateTime<Utc>,
    /// 고친 적 없으면 `null`.
    #[schema(required = true)]
    pub edited_at: Option<DateTime<Utc>>,
}

/// 앞뒤 공백 제거 후 1~1000자(유니코드 문자 수)가 아니면 400 `comment.bodyInvalid`.
pub fn normalize_body(raw: &str) -> AppResult<&str> {
    let body = raw.trim();
    if body.is_empty() || body.chars().count() > MAX_BODY_CHARS {
        return Err(AppError::bad_request("comment.bodyInvalid"));
    }
    Ok(body)
}

/// 멘션 토큰 `<@` + 소문자 하이픈 UUID 36자 + `>` 의 id 목록. 형식이 다른 것은 평문 취급.
pub fn mention_ids(body: &str) -> Vec<Uuid> {
    let mut ids = Vec::new();
    let mut rest = body;
    while let Some(pos) = rest.find("<@") {
        rest = &rest[pos + 2..];
        let Some(candidate) = rest.get(..36) else {
            continue;
        };
        if rest.as_bytes().get(36) == Some(&b'>') && is_lower_hyphenated(candidate) {
            if let Ok(id) = Uuid::parse_str(candidate) {
                ids.push(id);
            }
            rest = &rest[37..];
        }
    }
    ids.sort_unstable();
    ids.dedup();
    ids
}

/// 멘션 대상 중 없는 사용자가 있으면 400 `comment.mentionInvalid`. 이야기 본문 공용.
pub(crate) async fn check_mentions(exec: impl PgExecutor<'_>, body: &str) -> AppResult<()> {
    let ids = mention_ids(body);
    if !ids.is_empty() && queries::count_users(exec, &ids).await? != ids.len() as i64 {
        return Err(AppError::bad_request("comment.mentionInvalid"));
    }
    Ok(())
}

/// 댓글 목록 쿼리. 사진/이야기 공용.
#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub(crate) struct ListQuery {
    /// 이전 응답의 `next_cursor`.
    pub cursor: Option<String>,
    /// 1~100, 기본 100.
    pub limit: Option<i64>,
}

/// 댓글 작성/수정 요청. 사진/이야기 공용.
#[derive(Deserialize, ToSchema)]
pub(crate) struct CommentRequest {
    /// 앞뒤 공백 제거 후 1~1000자. 멘션은 `<@사용자id>`.
    pub body: String,
}

/// 본문 검증과 멘션 대상 존재 확인. 저장할 본문 반환.
pub(crate) async fn validate<'a>(exec: impl PgExecutor<'_>, raw: &'a str) -> AppResult<&'a str> {
    let body = normalize_body(raw)?;
    check_mentions(exec, body).await?;
    Ok(body)
}

/// 수정은 작성자만. 아니면 403 `comment.forbidden`.
pub(crate) fn check_can_edit(current: &CurrentUser, author_id: Uuid) -> AppResult<()> {
    if author_id != current.user.id {
        return Err(AppError::Forbidden("comment.forbidden"));
    }
    Ok(())
}

/// 삭제는 작성자 또는 owner, guardian. 아니면 403 `comment.forbidden`.
pub(crate) fn check_can_delete(current: &CurrentUser, author_id: Uuid) -> AppResult<()> {
    let moderator = matches!(current.user.role, Role::Owner | Role::Guardian);
    if author_id != current.user.id && !moderator {
        return Err(AppError::Forbidden("comment.forbidden"));
    }
    Ok(())
}

/// 댓글 목록 `limit` 검증. 1~100, 기본 100, 벗어나면 400 `request.invalidQuery`.
pub(crate) fn check_limit(limit: Option<i64>) -> AppResult<i64> {
    let limit = limit.unwrap_or(100);
    if !(1..=100).contains(&limit) {
        return Err(AppError::bad_request("request.invalidQuery"));
    }
    Ok(limit)
}

/// `limit + 1` 개 조회 결과를 페이지로 자름. `key` 는 커서 기준 (시각, id).
pub(crate) fn into_page<T>(
    mut items: Vec<T>,
    limit: i64,
    key: impl Fn(&T) -> (DateTime<Utc>, Uuid),
) -> Page<T> {
    let next_cursor = if items.len() as i64 > limit {
        items.truncate(limit as usize);
        items.last().map(|i| {
            let (ts, id) = key(i);
            cursor::encode(ts, id)
        })
    } else {
        None
    };
    Page { items, next_cursor }
}

fn is_lower_hyphenated(s: &str) -> bool {
    s.bytes().enumerate().all(|(i, b)| match i {
        8 | 13 | 18 | 23 => b == b'-',
        _ => b.is_ascii_digit() || (b'a'..=b'f').contains(&b),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mention_ids_parses_tokens() {
        let a = Uuid::now_v7();
        let b = Uuid::now_v7();
        let body = format!(
            "<@{a}> 와 <@{b}> 그리고 <@{a}> <@abc> <@{}>",
            a.to_string().to_uppercase()
        );
        let mut want = vec![a, b];
        want.sort_unstable();
        assert_eq!(mention_ids(&body), want);
    }

    #[test]
    fn mention_ids_handles_multibyte_and_truncated() {
        assert!(
            mention_ids(
                "<@가나다라마바사아자차카타파하가나다라마바사아자차카타파하가나다라마바사아자차카타"
            )
            .is_empty()
        );
        assert!(mention_ids("<@").is_empty());
    }

    #[test]
    fn body_normalized() {
        assert_eq!(normalize_body("  a ").unwrap(), "a");
        assert!(normalize_body(" ").is_err());
    }
}
