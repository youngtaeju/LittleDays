//! 마일스톤. 아기별 첫 순간 기록. 미리 정한 항목 또는 직접 입력 중 하나, 사진은 기존 사진 연결만.

use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    assets::AssetSummary,
    error::{AppError, AppResult},
};

pub mod presets;
pub mod queries;
pub mod routes;

const MAX_LABEL_CHARS: usize = 30;

/// 아기 화면, 하루 목록용 마일스톤.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct MilestoneSummary {
    pub id: Uuid,
    pub baby_id: Uuid,
    /// 직접 입력이면 `null`.
    #[schema(required = true)]
    pub preset_key: Option<String>,
    /// 미리 정한 항목이면 `null`.
    #[schema(required = true)]
    pub custom_label: Option<String>,
    pub achieved_on: NaiveDate,
    #[schema(required = true)]
    pub note: Option<String>,
    /// 붙인 순서 앞 4장. 휴지통 제외.
    pub previews: Vec<AssetSummary>,
    /// 휴지통 제외.
    pub asset_count: i64,
}

/// 마일스톤 상세.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct Milestone {
    #[serde(flatten)]
    pub summary: MilestoneSummary,
    /// 붙인 순서 전부. 휴지통 제외.
    pub assets: Vec<AssetSummary>,
    pub created_by: Uuid,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// 미리 정한 키가 목록에 없으면 400 `milestone.presetInvalid`.
fn check_preset(key: &str) -> AppResult<()> {
    if presets::PRESET_KEYS.contains(&key) {
        Ok(())
    } else {
        Err(AppError::bad_request("milestone.presetInvalid"))
    }
}

/// 앞뒤 공백 제거 후 1~30자(유니코드 문자 수)가 아니면 400 `milestone.labelInvalid`.
fn normalize_label(raw: &str) -> AppResult<&str> {
    let label = raw.trim();
    let n = label.chars().count();
    if n == 0 || n > MAX_LABEL_CHARS {
        return Err(AppError::bad_request("milestone.labelInvalid"));
    }
    Ok(label)
}

/// 정확히 하나만 있어야 함. 아니면 400 `milestone.labelInvalid`. 값은 검증, 정규화해 반환.
fn check_label_pair<'a>(
    preset: Option<&'a str>,
    custom: Option<&'a str>,
) -> AppResult<(Option<&'a str>, Option<&'a str>)> {
    match (preset, custom) {
        (Some(p), None) => {
            check_preset(p)?;
            Ok((Some(p), None))
        }
        (None, Some(c)) => Ok((None, Some(normalize_label(c)?))),
        _ => Err(AppError::bad_request("milestone.labelInvalid")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn label_pair_rules() {
        assert_eq!(
            check_label_pair(Some("crawl"), None).unwrap(),
            (Some("crawl"), None)
        );
        assert_eq!(
            check_label_pair(None, Some(" 첫 눈 ")).unwrap(),
            (None, Some("첫 눈"))
        );
        assert!(check_label_pair(None, None).is_err());
        assert!(check_label_pair(Some("crawl"), Some("x")).is_err());
        assert!(check_label_pair(Some("nope"), None).is_err());
        assert!(check_label_pair(None, Some(" ")).is_err());
        assert!(check_label_pair(None, Some(&"가".repeat(31))).is_err());
    }
}
