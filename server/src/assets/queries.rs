use chrono::{DateTime, NaiveDate, Utc};
use sqlx::PgExecutor;
use uuid::Uuid;

use super::{Asset, AssetKind, AssetStatus, AssetSummary, MonthCount, TakenAtSource, TrashItem};
use crate::error::AppResult;

/// `liked`, `favorited` 는 `viewer` 기준.
pub async fn get(exec: impl PgExecutor<'_>, id: Uuid, viewer: Uuid) -> AppResult<Option<Asset>> {
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
                  COALESCE((SELECT array_agg(aa.album_id)
                            FROM album_assets aa WHERE aa.asset_id = a.id), '{}')
                    AS "album_ids!",
                  a.derivatives, a.processing_error, a.created_at, a.deleted_at,
                  (SELECT count(*) FROM asset_likes l WHERE l.asset_id = a.id) AS "like_count!",
                  (SELECT count(*) FROM asset_comments c WHERE c.asset_id = a.id)
                    AS "comment_count!",
                  EXISTS (SELECT 1 FROM asset_likes l
                          WHERE l.asset_id = a.id AND l.user_id = $2) AS "liked!",
                  EXISTS (SELECT 1 FROM asset_favorites f
                          WHERE f.asset_id = a.id AND f.user_id = $2) AS "favorited!"
           FROM assets a WHERE a.id = $1"#,
        id,
        viewer
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

/// 처리 대상 원본.
pub struct Source {
    pub kind: AssetKind,
    /// `DATA_DIR` 기준 상대 경로.
    pub original_path: String,
}

pub async fn source(exec: impl PgExecutor<'_>, id: Uuid) -> AppResult<Option<Source>> {
    let found = sqlx::query_as!(
        Source,
        r#"SELECT kind AS "kind: AssetKind", original_path FROM assets WHERE id = $1"#,
        id
    )
    .fetch_optional(exec)
    .await?;
    Ok(found)
}

/// 바이트 서빙에 필요한 값.
pub struct FileInfo {
    pub kind: AssetKind,
    pub status: AssetStatus,
    pub mime: String,
    pub original_filename: String,
    /// `DATA_DIR` 기준 상대 경로.
    pub original_path: String,
    pub derivatives: serde_json::Value,
    pub deleted_at: Option<DateTime<Utc>>,
}

pub async fn file_info(exec: impl PgExecutor<'_>, id: Uuid) -> AppResult<Option<FileInfo>> {
    let found = sqlx::query_as!(
        FileInfo,
        r#"SELECT kind AS "kind: AssetKind", status AS "status: AssetStatus", mime,
                  original_filename, original_path, derivatives, deleted_at
           FROM assets WHERE id = $1"#,
        id
    )
    .fetch_optional(exec)
    .await?;
    Ok(found)
}

/// 처리 실패 기록. 행이 있었으면 `true`.
pub async fn mark_failed(exec: impl PgExecutor<'_>, id: Uuid, error: &str) -> AppResult<bool> {
    let res = sqlx::query!(
        "UPDATE assets SET status = 'failed', processing_error = $2 WHERE id = $1",
        id,
        error
    )
    .execute(exec)
    .await?;
    Ok(res.rows_affected() == 1)
}

/// `failed` 일 때만 `processing` 으로. 바꿨으면 `true`.
pub async fn mark_retry(exec: impl PgExecutor<'_>, id: Uuid) -> AppResult<bool> {
    let res = sqlx::query!(
        "UPDATE assets SET status = 'processing', processing_error = NULL
         WHERE id = $1 AND status = 'failed'",
        id
    )
    .execute(exec)
    .await?;
    Ok(res.rows_affected() == 1)
}

/// 휴지통 제외 목록. `limit` 만큼 가져오며 호출 측이 +1 로 다음 페이지 판정.
/// `date` 는 인스턴스 시간대 기준 촬영 날짜.
pub async fn list(
    exec: impl PgExecutor<'_>,
    timezone: &str,
    cursor: Option<(DateTime<Utc>, Uuid)>,
    baby_id: Option<Uuid>,
    date: Option<NaiveDate>,
    kind: Option<AssetKind>,
    limit: i64,
) -> AppResult<Vec<AssetSummary>> {
    let (cursor_ts, cursor_id) = cursor.unzip();
    let rows = sqlx::query_as!(
        AssetSummary,
        r#"SELECT a.id, a.kind AS "kind: AssetKind", a.status AS "status: AssetStatus",
                  a.taken_at, (a.taken_at AT TIME ZONE $1)::date AS "local_date!",
                  a.width, a.height, a.duration_ms, a.blurhash, a.dominant_color, a.uploaded_by,
                  COALESCE((SELECT array_agg(b.id ORDER BY b.sort_order, b.created_at, b.id)
                            FROM asset_babies ab JOIN babies b ON b.id = ab.baby_id
                            WHERE ab.asset_id = a.id), '{}') AS "baby_ids!",
                  a.derivatives
           FROM assets a
           WHERE a.deleted_at IS NULL
             AND ($2::timestamptz IS NULL OR (a.taken_at, a.id) < ($2, $3::uuid))
             AND ($4::uuid IS NULL OR EXISTS (
                   SELECT 1 FROM asset_babies ab WHERE ab.asset_id = a.id AND ab.baby_id = $4))
             AND ($5::date IS NULL OR (a.taken_at AT TIME ZONE $1)::date = $5)
             AND ($6::asset_kind IS NULL OR a.kind = $6)
           ORDER BY a.taken_at DESC, a.id DESC
           LIMIT $7"#,
        timezone,
        cursor_ts,
        cursor_id,
        baby_id,
        date,
        kind as Option<AssetKind>,
        limit,
    )
    .fetch_all(exec)
    .await?;
    Ok(rows)
}

/// 휴지통 제외 월별 개수. 최신 월부터.
pub async fn months(
    exec: impl PgExecutor<'_>,
    timezone: &str,
    baby_id: Option<Uuid>,
) -> AppResult<Vec<MonthCount>> {
    let rows = sqlx::query_as!(
        MonthCount,
        r#"SELECT to_char(a.taken_at AT TIME ZONE $1, 'YYYY-MM') AS "month!",
                  count(*) AS "count!"
           FROM assets a
           WHERE a.deleted_at IS NULL
             AND ($2::uuid IS NULL OR EXISTS (
                   SELECT 1 FROM asset_babies ab WHERE ab.asset_id = a.id AND ab.baby_id = $2))
           GROUP BY 1
           ORDER BY 1 DESC"#,
        timezone,
        baby_id,
    )
    .fetch_all(exec)
    .await?;
    Ok(rows)
}

/// 캡션과 촬영 시각 갱신. `caption` 이 `Some` 이면 덮어씀(내부 `None` 은 비움).
/// `taken_at` 지정 시 출처 `manual`. 행이 있었으면 `true`.
pub async fn update_meta(
    exec: impl PgExecutor<'_>,
    id: Uuid,
    caption: Option<Option<&str>>,
    taken_at: Option<DateTime<Utc>>,
) -> AppResult<bool> {
    let res = sqlx::query!(
        "UPDATE assets SET
             caption = CASE WHEN $2 THEN $3 ELSE caption END,
             taken_at = COALESCE($4, taken_at),
             taken_at_source = CASE WHEN $4::timestamptz IS NULL
                                    THEN taken_at_source ELSE 'manual'::taken_at_source END
         WHERE id = $1",
        id,
        caption.is_some(),
        caption.flatten(),
        taken_at,
    )
    .execute(exec)
    .await?;
    Ok(res.rows_affected() == 1)
}

/// 목록에 없는 태그 제거. 유지되는 태그 행은 그대로.
pub async fn remove_babies_except(
    exec: impl PgExecutor<'_>,
    asset_id: Uuid,
    keep: &[Uuid],
) -> AppResult<()> {
    sqlx::query!(
        "DELETE FROM asset_babies WHERE asset_id = $1 AND baby_id <> ALL($2::uuid[])",
        asset_id,
        keep,
    )
    .execute(exec)
    .await?;
    Ok(())
}

/// 휴지통으로. 이미 휴지통이면 시각 유지. 대표사진 해제. 행이 있었으면 `true`.
pub async fn move_to_trash(tx: &mut sqlx::PgConnection, id: Uuid) -> AppResult<bool> {
    let res = sqlx::query!(
        "UPDATE assets SET deleted_at = COALESCE(deleted_at, now()) WHERE id = $1",
        id
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!(
        "UPDATE babies SET avatar_asset_id = NULL WHERE avatar_asset_id = $1",
        id
    )
    .execute(&mut *tx)
    .await?;
    Ok(res.rows_affected() == 1)
}

/// 휴지통 상태일 때만 복구. 복구했으면 `true`.
pub async fn restore(exec: impl PgExecutor<'_>, id: Uuid) -> AppResult<bool> {
    let res = sqlx::query!(
        "UPDATE assets SET deleted_at = NULL WHERE id = $1 AND deleted_at IS NOT NULL",
        id
    )
    .execute(exec)
    .await?;
    Ok(res.rows_affected() == 1)
}

/// 휴지통 목록. `limit` 만큼 가져오며 호출 측이 +1 로 다음 페이지 판정.
pub async fn list_trash(
    exec: impl PgExecutor<'_>,
    timezone: &str,
    cursor: Option<(DateTime<Utc>, Uuid)>,
    limit: i64,
) -> AppResult<Vec<TrashItem>> {
    let (cursor_ts, cursor_id) = cursor.unzip();
    let rows = sqlx::query!(
        r#"SELECT a.id, a.kind AS "kind: AssetKind", a.status AS "status: AssetStatus",
                  a.taken_at, (a.taken_at AT TIME ZONE $1)::date AS "local_date!",
                  a.width, a.height, a.duration_ms, a.blurhash, a.dominant_color, a.uploaded_by,
                  COALESCE((SELECT array_agg(b.id ORDER BY b.sort_order, b.created_at, b.id)
                            FROM asset_babies ab JOIN babies b ON b.id = ab.baby_id
                            WHERE ab.asset_id = a.id), '{}') AS "baby_ids!",
                  a.derivatives, a.deleted_at AS "deleted_at!"
           FROM assets a
           WHERE a.deleted_at IS NOT NULL
             AND ($2::timestamptz IS NULL OR (a.deleted_at, a.id) < ($2, $3::uuid))
           ORDER BY a.deleted_at DESC, a.id DESC
           LIMIT $4"#,
        timezone,
        cursor_ts,
        cursor_id,
        limit,
    )
    .fetch_all(exec)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| TrashItem {
            asset: AssetSummary {
                id: r.id,
                kind: r.kind,
                status: r.status,
                taken_at: r.taken_at,
                local_date: r.local_date,
                width: r.width,
                height: r.height,
                duration_ms: r.duration_ms,
                blurhash: r.blurhash,
                dominant_color: r.dominant_color,
                uploaded_by: r.uploaded_by,
                baby_ids: r.baby_ids,
                derivatives: r.derivatives,
            },
            deleted_at: r.deleted_at,
        })
        .collect())
}

pub async fn trash_ids(exec: impl PgExecutor<'_>) -> AppResult<Vec<Uuid>> {
    let ids = sqlx::query_scalar!("SELECT id FROM assets WHERE deleted_at IS NOT NULL")
        .fetch_all(exec)
        .await?;
    Ok(ids)
}

/// 휴지통 이동 후 `days` 일이 지난 행만 삭제. 판정과 삭제가 한 문장이라 그 사이 복구·재삭제와 경합 없음.
pub async fn delete_expired_trash(exec: impl PgExecutor<'_>, days: i32) -> AppResult<Vec<Trashed>> {
    let rows = sqlx::query_as!(
        Trashed,
        "DELETE FROM assets WHERE deleted_at < now() - make_interval(days => $1)
         RETURNING id, original_path",
        days
    )
    .fetch_all(exec)
    .await?;
    Ok(rows)
}

/// 영구 삭제 결과 행.
pub struct Trashed {
    pub id: Uuid,
    /// `DATA_DIR` 기준 상대 경로.
    pub original_path: String,
}

/// 휴지통 상태인 행만 삭제.
pub async fn delete_trashed(exec: impl PgExecutor<'_>, ids: &[Uuid]) -> AppResult<Vec<Trashed>> {
    let rows = sqlx::query_as!(
        Trashed,
        "DELETE FROM assets WHERE id = ANY($1::uuid[]) AND deleted_at IS NOT NULL
         RETURNING id, original_path",
        ids
    )
    .fetch_all(exec)
    .await?;
    Ok(rows)
}

/// 자산 id 목록의 작업 행 삭제.
pub async fn delete_jobs(exec: impl PgExecutor<'_>, ids: &[Uuid]) -> AppResult<()> {
    let ids: Vec<String> = ids.iter().map(Uuid::to_string).collect();
    sqlx::query!(
        "DELETE FROM jobs WHERE payload ->> 'asset_id' = ANY($1::text[])",
        &ids
    )
    .execute(exec)
    .await?;
    Ok(())
}
