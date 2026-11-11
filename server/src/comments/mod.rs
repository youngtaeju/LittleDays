//! 사진 댓글. 휴지통 사진의 댓글은 읽기와 쓰기 모두 막음.

use chrono::{DateTime, Utc};
use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::error::{AppError, AppResult};

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
