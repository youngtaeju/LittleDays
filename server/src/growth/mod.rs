//! 성장 기록. 아기별 키와 몸무게, 같은 날 여러 건 허용.

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Deserializer, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::error::{AppError, AppResult};

pub mod queries;
pub mod routes;

const MAX_NOTE_CHARS: usize = 100;

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct GrowthRecord {
    pub id: Uuid,
    pub baby_id: Uuid,
    pub measured_on: NaiveDate,
    /// cm, 소수 1자리. 없으면 `null`.
    #[schema(required = true)]
    pub height_cm: Option<f64>,
    /// kg, 소수 2자리. 없으면 `null`.
    #[schema(required = true)]
    pub weight_kg: Option<f64>,
    #[schema(required = true)]
    pub note: Option<String>,
    pub created_by: Uuid,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// 필드 생략과 `null` 구분. 생략 `None`, `null` `Some(None)`.
pub(crate) fn present<'de, T, D>(d: D) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: Deserializer<'de>,
{
    Option::<T>::deserialize(d).map(Some)
}

/// 범위 안이고 소수 `scale` 자리 이내면 통과. 반올림 비교라 0.57 같은 값도 안전.
fn in_range(x: f64, min: f64, max: f64, scale: f64) -> bool {
    x.is_finite() && x >= min && x <= max && (x * scale).round() / scale == x
}

/// 키 20.0~150.0 cm, 소수 1자리.
pub(crate) fn check_height(x: f64) -> AppResult<()> {
    if in_range(x, 20.0, 150.0, 10.0) {
        Ok(())
    } else {
        Err(AppError::bad_request("growth.valueInvalid"))
    }
}

/// 몸무게 0.50~50.00 kg, 소수 2자리.
pub(crate) fn check_weight(x: f64) -> AppResult<()> {
    if in_range(x, 0.5, 50.0, 100.0) {
        Ok(())
    } else {
        Err(AppError::bad_request("growth.valueInvalid"))
    }
}

/// 앞뒤 공백 제거, 빈 값은 `None`. 100자(유니코드 문자 수) 초과면 400 `growth.noteInvalid`.
pub(crate) fn normalize_note(raw: &str) -> AppResult<Option<&str>> {
    normalize_note_or(raw, "growth.noteInvalid")
}

/// `normalize_note` 의 오류 키 지정판. 마일스톤 공용.
pub(crate) fn normalize_note_or<'a>(raw: &'a str, key: &'static str) -> AppResult<Option<&'a str>> {
    let note = raw.trim();
    if note.chars().count() > MAX_NOTE_CHARS {
        return Err(AppError::bad_request(key));
    }
    Ok((!note.is_empty()).then_some(note))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decimals_are_float_safe() {
        for w in [0.57, 1.15, 4.35, 0.5, 50.0] {
            assert!(check_weight(w).is_ok(), "{w}");
        }
        for w in [4.355, 0.49, 50.01] {
            assert!(check_weight(w).is_err(), "{w}");
        }
        for h in [20.0, 76.2, 150.0] {
            assert!(check_height(h).is_ok(), "{h}");
        }
        for h in [76.25, 19.9, 150.1, f64::NAN] {
            assert!(check_height(h).is_err(), "{h}");
        }
    }

    #[test]
    fn note_normalized() {
        assert_eq!(normalize_note("  ").unwrap(), None);
        assert_eq!(normalize_note(" a ").unwrap(), Some("a"));
        assert!(normalize_note(&"가".repeat(101)).is_err());
    }
}
