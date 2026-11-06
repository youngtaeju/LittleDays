use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;
use uuid::Uuid;

pub mod queries;

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
    /// 파생물 파일 정보. 처리 전 `{}`.
    #[schema(value_type = Object)]
    pub derivatives: Value,
    #[schema(required = true)]
    pub processing_error: Option<String>,
    pub created_at: DateTime<Utc>,
    /// 휴지통 이동 시각.
    #[schema(required = true)]
    pub deleted_at: Option<DateTime<Utc>>,
}
