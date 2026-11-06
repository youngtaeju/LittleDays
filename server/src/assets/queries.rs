use chrono::{DateTime, Utc};
use sqlx::PgExecutor;
use uuid::Uuid;

use super::{Asset, AssetKind, AssetStatus, TakenAtSource};
use crate::error::AppResult;

pub async fn get(exec: impl PgExecutor<'_>, id: Uuid) -> AppResult<Option<Asset>> {
    let asset = sqlx::query_as!(
        Asset,
        r#"SELECT a.id, a.kind AS "kind: AssetKind", a.status AS "status: AssetStatus",
                  a.taken_at, a.taken_at_source AS "taken_at_source: TakenAtSource",
                  a.file_modified_at, a.original_filename, a.mime, a.size_bytes,
                  a.width, a.height, a.duration_ms, a.gps_lat, a.gps_lon,
                  a.camera_make, a.camera_model, a.blurhash, a.dominant_color, a.caption,
                  a.uploaded_by,
                  COALESCE((SELECT array_agg(b.id ORDER BY b.sort_order, b.created_at, b.id)
                            FROM asset_babies ab JOIN babies b ON b.id = ab.baby_id
                            WHERE ab.asset_id = a.id), '{}') AS "baby_ids!",
                  a.derivatives, a.processing_error, a.created_at, a.deleted_at
           FROM assets a WHERE a.id = $1"#,
        id
    )
    .fetch_optional(exec)
    .await?;
    Ok(asset)
}

/// 같은 해시의 기존 자산 (중복 판정용).
pub struct ShaMatch {
    pub id: Uuid,
    pub status: AssetStatus,
    pub original_path: String,
    pub deleted_at: Option<DateTime<Utc>>,
}

pub async fn find_by_sha256(
    exec: impl PgExecutor<'_>,
    sha256: &[u8],
) -> AppResult<Option<ShaMatch>> {
    let found = sqlx::query_as!(
        ShaMatch,
        r#"SELECT id, status AS "status: AssetStatus", original_path, deleted_at
           FROM assets WHERE sha256 = $1"#,
        sha256
    )
    .fetch_optional(exec)
    .await?;
    Ok(found)
}

/// finalize 시점 값만. 나머지는 워커가 채움.
pub struct NewAsset<'a> {
    pub id: Uuid,
    pub kind: AssetKind,
    pub uploaded_by: Uuid,
    pub original_path: &'a str,
    pub original_filename: &'a str,
    pub mime: &'a str,
    pub size_bytes: i64,
    pub sha256: &'a [u8],
    pub taken_at: DateTime<Utc>,
    pub taken_at_source: TakenAtSource,
    pub file_modified_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

/// `sha256` unique 위반은 `sqlx::Error` 그대로 전달 (호출 측 409 변환).
pub async fn insert(exec: impl PgExecutor<'_>, new: &NewAsset<'_>) -> AppResult<()> {
    sqlx::query!(
        "INSERT INTO assets (id, kind, uploaded_by, original_path, original_filename, mime,
                             size_bytes, sha256, taken_at, taken_at_source, file_modified_at,
                             created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
        new.id,
        new.kind as AssetKind,
        new.uploaded_by,
        new.original_path,
        new.original_filename,
        new.mime,
        new.size_bytes,
        new.sha256,
        new.taken_at,
        new.taken_at_source as TakenAtSource,
        new.file_modified_at,
        new.created_at,
    )
    .execute(exec)
    .await?;
    Ok(())
}

/// 이미 붙은 태그는 무시.
pub async fn add_babies(
    exec: impl PgExecutor<'_>,
    asset_id: Uuid,
    baby_ids: &[Uuid],
    tagged_by: Uuid,
) -> AppResult<()> {
    sqlx::query!(
        "INSERT INTO asset_babies (asset_id, baby_id, tagged_by)
         SELECT $1, baby_id, $3 FROM unnest($2::uuid[]) AS t(baby_id)
         ON CONFLICT DO NOTHING",
        asset_id,
        baby_ids,
        tagged_by,
    )
    .execute(exec)
    .await?;
    Ok(())
}

/// `failed` 상태일 때만 삭제. 삭제했으면 `true`.
pub async fn delete_failed(exec: impl PgExecutor<'_>, id: Uuid) -> AppResult<bool> {
    let res = sqlx::query!("DELETE FROM assets WHERE id = $1 AND status = 'failed'", id)
        .execute(exec)
        .await?;
    Ok(res.rows_affected() == 1)
}
