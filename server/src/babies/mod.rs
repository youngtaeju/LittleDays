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
    #[schema(required = true)]
    pub avatar_crop: Option<AvatarCrop>,
    pub sort_order: i32,
}

/// 대표 사진 정사각 자르기. 회전 적용 후 원본 기준, 좌상단 `x`·`y` 와 한 변 `size` 모두 비율.
/// `x`·`y` 는 가로·세로 길이 대비, `size` 는 짧은 변 대비.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema)]
pub struct AvatarCrop {
    pub x: f64,
    pub y: f64,
    pub size: f64,
}

impl AvatarCrop {
    /// 유한수, `size` (0, 1], `x`·`y` 비음수, 영역이 `width`×`height` 안.
    pub fn fits(&self, width: i32, height: i32) -> bool {
        const EPS: f64 = 1e-6;
        let (w, h) = (f64::from(width), f64::from(height));
        let side = self.size * w.min(h);
        [self.x, self.y, self.size].iter().all(|v| v.is_finite())
            && self.size > 0.0
            && self.size <= 1.0
            && self.x >= 0.0
            && self.y >= 0.0
            && self.x * w + side <= w + EPS
            && self.y * h + side <= h + EPS
    }
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
