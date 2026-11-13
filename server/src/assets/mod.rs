use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;
use uuid::Uuid;

pub mod cursor;
pub mod files;
pub mod queries;
pub mod routes;
pub mod trash;

#[derive(Debug, Clone, Copy, PartialEq, Eq, sqlx::Type, Serialize, Deserialize, ToSchema)]
#[sqlx(type_name = "asset_kind", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum AssetKind {
    Photo,
    Video,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, sqlx::Type, Serialize, Deserialize, ToSchema)]
#[sqlx(type_name = "asset_status", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum AssetStatus {
    Processing,
    Ready,
    Failed,
}

/// 촬영일 출처.
#[derive(Debug, Clone, Copy, PartialEq, Eq, sqlx::Type, Serialize, Deserialize, ToSchema)]
#[sqlx(type_name = "taken_at_source", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum TakenAtSource {
    Exif,
    VideoMeta,
    FileMtime,
    UploadTime,
    Import,
    Manual,
}

// 문서 전용 스키마. 직렬화는 `Value`.
/// 파생물 한 종류.
#[derive(ToSchema)]
#[allow(dead_code)]
pub struct VariantDoc {
    pub width: u32,
    pub height: u32,
    /// 예: `webp`, `avif`, `mp4`.
    pub formats: Vec<String>,
}

// 문서 전용 스키마. 직렬화는 `Value`.
/// 파생물 파일 정보. 처리 전 `{}`.
#[derive(ToSchema)]
#[allow(dead_code)]
pub struct DerivativesDoc {
    pub thumb: Option<VariantDoc>,
    pub preview: Option<VariantDoc>,
    pub large: Option<VariantDoc>,
    pub playback: Option<VariantDoc>,
}

/// 자산 상세.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct Asset {
    pub id: Uuid,
    pub kind: AssetKind,
    pub status: AssetStatus,
    pub taken_at: DateTime<Utc>,
    pub taken_at_source: TakenAtSource,
    #[schema(required = true)]
    pub file_modified_at: Option<DateTime<Utc>>,
    pub original_filename: String,
    pub mime: String,
    pub size_bytes: i64,
    #[schema(required = true)]
    pub width: Option<i32>,
    #[schema(required = true)]
    pub height: Option<i32>,
    #[schema(required = true)]
    pub duration_ms: Option<i32>,
    #[schema(required = true)]
    pub gps_lat: Option<f64>,
    #[schema(required = true)]
    pub gps_lon: Option<f64>,
    #[schema(required = true)]
    pub camera_make: Option<String>,
    #[schema(required = true)]
    pub camera_model: Option<String>,
    #[schema(required = true)]
    pub blurhash: Option<String>,
    #[schema(required = true)]
    pub dominant_color: Option<String>,
    #[schema(required = true)]
    pub caption: Option<String>,
    pub uploaded_by: Uuid,
    /// 아기 표시 순서.
    pub baby_ids: Vec<Uuid>,
    /// 든 앨범. 순서 없음.
    pub album_ids: Vec<Uuid>,
    /// 파생물 파일 정보. 처리 전 `{}`.
    #[schema(value_type = DerivativesDoc)]
    pub derivatives: Value,
    #[schema(required = true)]
    pub processing_error: Option<String>,
    pub created_at: DateTime<Utc>,
    /// 휴지통 이동 시각.
    #[schema(required = true)]
    pub deleted_at: Option<DateTime<Utc>>,
    pub like_count: i64,
    pub comment_count: i64,
    /// 요청자의 하트 여부.
    pub liked: bool,
    /// 요청자의 즐겨찾기 여부.
    pub favorited: bool,
}

/// 타임라인 목록 항목.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AssetSummary {
    pub id: Uuid,
    pub kind: AssetKind,
    pub status: AssetStatus,
    pub taken_at: DateTime<Utc>,
    /// 인스턴스 시간대 기준 촬영 날짜.
    pub local_date: NaiveDate,
    #[schema(required = true)]
    pub width: Option<i32>,
    #[schema(required = true)]
    pub height: Option<i32>,
    #[schema(required = true)]
    pub duration_ms: Option<i32>,
    #[schema(required = true)]
    pub blurhash: Option<String>,
    #[schema(required = true)]
    pub dominant_color: Option<String>,
    pub uploaded_by: Uuid,
    /// 아기 표시 순서.
    pub baby_ids: Vec<Uuid>,
    /// 파생물 파일 정보. 처리 전 `{}`.
    #[schema(value_type = DerivativesDoc)]
    pub derivatives: Value,
}

/// 휴지통 목록 항목.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct TrashItem {
    #[serde(flatten)]
    pub asset: AssetSummary,
    /// 휴지통 이동 시각.
    pub deleted_at: DateTime<Utc>,
}

/// 커서 페이지.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct Page<T> {
    pub items: Vec<T>,
    /// 다음 페이지가 없으면 `null`.
    #[schema(required = true)]
    pub next_cursor: Option<String>,
}

/// 월별 자산 수.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct MonthCount {
    /// 인스턴스 시간대 기준 `YYYY-MM`.
    pub month: String,
    pub count: i64,
}
