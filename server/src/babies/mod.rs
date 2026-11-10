use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::assets::AssetSummary;

pub mod queries;
pub mod routes;

#[derive(Debug, Clone, Copy, PartialEq, Eq, sqlx::Type, Serialize, Deserialize, ToSchema)]
#[sqlx(type_name = "baby_sex", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum Sex {
    Female,
    Male,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct Baby {
    pub id: Uuid,
    pub name: String,
    pub birth_date: NaiveDate,
    #[schema(required = true)]
    pub sex: Option<Sex>,
    #[schema(required = true)]
    pub avatar_asset_id: Option<Uuid>,
    pub sort_order: i32,
}

/// 생성·전체 교체 공용 입력. 이름은 검증·정규화 완료 상태.
pub struct BabyInput {
    pub name: String,
    pub birth_date: NaiveDate,
    pub sex: Option<Sex>,
}

/// 아기 태그 자산 통계. 휴지통 제외.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct BabyStats {
    pub photo_count: i64,
    pub video_count: i64,
    /// 사진이 있는 날 수.
    pub day_count: i64,
    /// 최신 개월부터. `-1`(생일 전)은 맨 끝. 사진 없는 개월은 없음.
    pub age_months: Vec<AgeMonth>,
}

/// 생후 개월 묶음. 개월 경계는 월말 고정 기념일 규칙(웹 `ageAt` 과 동일).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AgeMonth {
    /// 생일 전 `-1`, 그 외 생후 개월 수.
    pub age_month: i32,
    pub count: i64,
    /// 그 개월 최신 자산.
    pub cover: AssetSummary,
    /// 개월 시작일(포함). 생일 전은 `null`.
    #[schema(required = true)]
    pub from: Option<NaiveDate>,
    /// 개월 마지막 날(포함). 생일 전은 생일 전날.
    pub to: NaiveDate,
}
