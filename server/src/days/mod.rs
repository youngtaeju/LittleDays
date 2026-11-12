//! 하루 단위 묶음. 날짜 집합은 사진 촬영일(인스턴스 시간대, 휴지통 제외), 이야기 날짜, 마일스톤 달성일의 합집합.

use chrono::NaiveDate;
use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{assets::AssetSummary, milestones::MilestoneSummary, stories::StorySummary};

pub mod queries;
pub mod routes;

/// 홈 피드의 하루 묶음.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct DaySummary {
    /// 사진 촬영일(인스턴스 시간대), 이야기 날짜, 마일스톤 달성일 중 하나.
    pub date: NaiveDate,
    pub photo_count: i64,
    pub video_count: i64,
    /// 그날 올린 사용자. 중복 없음, 순서 무의미.
    pub uploader_ids: Vec<Uuid>,
    /// 그날 사진 태그, 이야기 태그, 마일스톤 아기의 합집합. 아기 표시 순서.
    pub baby_ids: Vec<Uuid>,
    /// 그날 자산 하트 합계.
    pub like_count: i64,
    /// 그날 자산 댓글 합계.
    pub comment_count: i64,
    /// 그날 최신 3장. 촬영 시각 최신순. 사진 없는 날은 빈 배열.
    pub preview: Vec<AssetSummary>,
    /// 그날 이야기. 쓴 시각 오래된 순.
    pub stories: Vec<StorySummary>,
    /// 그날 마일스톤. 기록 순.
    pub milestones: Vec<MilestoneSummary>,
}

/// 그날 화면 머리글과 이전·다음 날.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct DayDetail {
    /// 사진 촬영일(인스턴스 시간대), 이야기 날짜, 마일스톤 달성일 중 하나.
    pub date: NaiveDate,
    pub photo_count: i64,
    pub video_count: i64,
    /// 그날 올린 사용자. 중복 없음, 순서 무의미.
    pub uploader_ids: Vec<Uuid>,
    /// 그날 사진 태그, 이야기 태그, 마일스톤 아기의 합집합. 아기 표시 순서.
    pub baby_ids: Vec<Uuid>,
    /// 그날 자산 하트 합계.
    pub like_count: i64,
    /// 그날 자산 댓글 합계.
    pub comment_count: i64,
    /// 더 과거의 사진, 이야기, 마일스톤 있는 날.
    #[schema(required = true)]
    pub prev_date: Option<NaiveDate>,
    /// 더 최근의 사진, 이야기, 마일스톤 있는 날.
    #[schema(required = true)]
    pub next_date: Option<NaiveDate>,
    /// 그날 이야기. 쓴 시각 오래된 순.
    pub stories: Vec<StorySummary>,
    /// 그날 마일스톤. 기록 순.
    pub milestones: Vec<MilestoneSummary>,
}
