//! 촬영일(인스턴스 시간대) 하루 단위 묶음. 휴지통 제외.

use chrono::NaiveDate;
use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::assets::AssetSummary;

pub mod queries;
pub mod routes;

/// 홈 피드의 하루 묶음.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct DaySummary {
    /// 인스턴스 시간대 기준 촬영 날짜.
    pub date: NaiveDate,
    pub photo_count: i64,
    pub video_count: i64,
    /// 그날 올린 사용자. 중복 없음, 순서 무의미.
    pub uploader_ids: Vec<Uuid>,
    /// 그날 태그된 아기. 아기 표시 순서.
    pub baby_ids: Vec<Uuid>,
    /// 그날 자산 하트 합계.
    pub like_count: i64,
    /// 그날 자산 댓글 합계.
    pub comment_count: i64,
    /// 그날 최신 3장. 촬영 시각 최신순.
    pub preview: Vec<AssetSummary>,
}

/// 그날 화면 머리글과 이전·다음 날.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct DayDetail {
    /// 인스턴스 시간대 기준 촬영 날짜.
    pub date: NaiveDate,
    pub photo_count: i64,
    pub video_count: i64,
    /// 그날 올린 사용자. 중복 없음, 순서 무의미.
    pub uploader_ids: Vec<Uuid>,
    /// 그날 태그된 아기. 아기 표시 순서.
    pub baby_ids: Vec<Uuid>,
    /// 그날 자산 하트 합계.
    pub like_count: i64,
    /// 그날 자산 댓글 합계.
    pub comment_count: i64,
    /// 더 과거의 사진 있는 날.
    #[schema(required = true)]
    pub prev_date: Option<NaiveDate>,
    /// 더 최근의 사진 있는 날.
    #[schema(required = true)]
    pub next_date: Option<NaiveDate>,
}
