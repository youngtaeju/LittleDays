//! 이야기, 성장 기록, 마일스톤 공용 입력 규칙.

use chrono::NaiveDate;
use serde::{Deserialize, Deserializer};
use sqlx::PgExecutor;
use uuid::Uuid;

use crate::error::{AppError, AppResult};

const MAX_NOTE_CHARS: usize = 100;

/// 필드 생략과 `null` 구분. 생략 `None`, `null` `Some(None)`.
pub(crate) fn present<'de, T, D>(d: D) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: Deserializer<'de>,
{
    Option::<T>::deserialize(d).map(Some)
}

/// 앞뒤 공백 제거, 빈 값은 `None`. 100자(유니코드 문자 수) 초과면 400 `key`.
pub(crate) fn normalize_note_or<'a>(raw: &'a str, key: &'static str) -> AppResult<Option<&'a str>> {
    let note = raw.trim();
    if note.chars().count() > MAX_NOTE_CHARS {
        return Err(AppError::bad_request(key));
    }
    Ok((!note.is_empty()).then_some(note))
}

/// 인스턴스 시간대 오늘 이전(오늘 포함)이면 `true`.
pub async fn not_future(
    exec: impl PgExecutor<'_>,
    timezone: &str,
    date: NaiveDate,
) -> AppResult<bool> {
    Ok(sqlx::query_scalar!(
        r#"SELECT $2::date <= (now() AT TIME ZONE $1)::date AS "ok!""#,
        timezone,
        date
    )
    .fetch_one(exec)
    .await?)
}

/// 아기 생일. 아기 없으면 `None`.
/// 쓰기 트랜잭션 안에서 호출 시 커밋까지 아기 삭제 차단(기록 쓰기의 FK 위반 방지).
pub async fn baby_birth_date(
    exec: impl PgExecutor<'_>,
    baby_id: Uuid,
) -> AppResult<Option<NaiveDate>> {
    Ok(sqlx::query_scalar!(
        "SELECT birth_date FROM babies WHERE id = $1 FOR KEY SHARE",
        baby_id
    )
    .fetch_optional(exec)
    .await?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn note_normalized() {
        assert_eq!(normalize_note_or("  ", "k").unwrap(), None);
        assert_eq!(normalize_note_or(" a ", "k").unwrap(), Some("a"));
        assert!(normalize_note_or(&"가".repeat(100), "k").is_ok());
        assert!(normalize_note_or(&"가".repeat(101), "k").is_err());
    }
}
