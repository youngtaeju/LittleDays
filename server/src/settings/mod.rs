use serde::Serialize;
use utoipa::ToSchema;

pub mod queries;
pub mod routes;

/// 인스턴스 설정. 미저장 키는 기본값.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct Settings {
    pub instance_name: String,
    /// IANA 시간대. 날짜 묶음 기준.
    pub timezone: String,
    /// 새 사용자 기본 UI 언어. `ko` 또는 `en`.
    pub default_locale: String,
    /// AVIF 파생물 생성 여부.
    pub derivatives_avif: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            instance_name: "LittleDays".to_string(),
            timezone: "Asia/Seoul".to_string(),
            default_locale: "ko".to_string(),
            derivatives_avif: false,
        }
    }
}
