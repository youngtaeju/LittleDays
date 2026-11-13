use std::collections::HashMap;

use chrono::{DateTime, Utc};
use sqlx::{PgConnection, PgExecutor};
use uuid::Uuid;

use super::AlbumSummary;
use crate::{
    assets::{AssetKind, AssetStatus, AssetSummary},
    error::AppResult,
};

/// `ids` 가 `None` 이면 전체. 순서: 휴지통 아닌 사진의 마지막 넣은 시각(비면 만든 시각) 최신순, 동률 id.
/// 없는 id 는 빠짐.
pub async fn summaries(
    conn: &mut PgConnection,
    timezone: &str,
    ids: Option<&[Uuid]>,
) -> AppResult<Vec<AlbumSummary>> {
    let rows = sqlx::query!(
        r#"SELECT al.id, al.name, al.created_by, al.created_at, al.updated_at,
                  s.photo_count AS "photo_count!", s.video_count AS "video_count!",
                  s.first_date AS "from?", s.last_date AS "to?",
                  COALESCE(
                      (SELECT a.id FROM album_assets aa JOIN assets a ON a.id = aa.asset_id
                       WHERE aa.album_id = al.id AND aa.asset_id = al.cover_asset_id
                         AND a.deleted_at IS NULL AND a.status = 'ready'),
                      (SELECT a.id FROM album_assets aa JOIN assets a ON a.id = aa.asset_id
                       WHERE aa.album_id = al.id AND a.deleted_at IS NULL AND a.status = 'ready'
                       ORDER BY a.taken_at, a.id
                       LIMIT 1)
                  ) AS "cover_id?"
           FROM albums al
           CROSS JOIN LATERAL (
               SELECT count(*) FILTER (WHERE a.kind = 'photo') AS photo_count,
                      count(*) FILTER (WHERE a.kind = 'video') AS video_count,
                      min((a.taken_at AT TIME ZONE $1)::date) AS first_date,
                      max((a.taken_at AT TIME ZONE $1)::date) AS last_date,
                      max(aa.added_at) AS last_added
               FROM album_assets aa JOIN assets a ON a.id = aa.asset_id
               WHERE aa.album_id = al.id AND a.deleted_at IS NULL
           ) s
           WHERE $2::uuid[] IS NULL OR al.id = ANY($2)
           ORDER BY COALESCE(s.last_added, al.created_at) DESC, al.id DESC"#,
        timezone,
        ids,
    )
    .fetch_all(&mut *conn)
    .await?;

    let cover_ids: Vec<Uuid> = rows.iter().filter_map(|r| r.cover_id).collect();
    let covers: HashMap<Uuid, AssetSummary> = asset_summaries(&mut *conn, timezone, &cover_ids)
        .await?
        .into_iter()
        .map(|a| (a.id, a))
        .collect();
    Ok(rows
        .into_iter()
        .map(|r| AlbumSummary {
            id: r.id,
            name: r.name,
            cover: r.cover_id.and_then(|id| covers.get(&id).cloned()),
            photo_count: r.photo_count,
            video_count: r.video_count,
            from: r.from,
            to: r.to,
            created_by: r.created_by,
            created_at: r.created_at,
            updated_at: r.updated_at,
        })
        .collect())
}

/// 표지용 사진 요약. 순서 무의미.
async fn asset_summaries(
    exec: impl PgExecutor<'_>,
    timezone: &str,
    ids: &[Uuid],
) -> AppResult<Vec<AssetSummary>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
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
           WHERE a.id = ANY($2)"#,
        timezone,
        ids,
    )
    .fetch_all(exec)
    .await?;
    Ok(rows)
}

/// 앨범 존재 여부. 잠금 없음(읽기 전용 조회용).
pub async fn exists(exec: impl PgExecutor<'_>, album_id: Uuid) -> AppResult<bool> {
    let found = sqlx::query_scalar!(
        r#"SELECT EXISTS(SELECT 1 FROM albums WHERE id = $1) AS "exists!""#,
        album_id
    )
    .fetch_one(exec)
    .await?;
    Ok(found)
}

/// 앨범 있으면 `true`. 트랜잭션 안에서 호출 시 커밋까지 앨범 삭제 차단(연결 쓰기의 FK 위반 방지).
pub async fn lock_for_link(exec: impl PgExecutor<'_>, album_id: Uuid) -> AppResult<bool> {
    let found = sqlx::query_scalar!(
        "SELECT id FROM albums WHERE id = $1 FOR KEY SHARE",
        album_id
    )
    .fetch_optional(exec)
    .await?;
    Ok(found.is_some())
}

pub async fn insert(
    exec: impl PgExecutor<'_>,
    id: Uuid,
    name: &str,
    created_by: Uuid,
) -> AppResult<()> {
    sqlx::query!(
        "INSERT INTO albums (id, name, created_by) VALUES ($1, $2, $3)",
        id,
        name,
        created_by
    )
    .execute(exec)
    .await?;
    Ok(())
}

/// 검사 끝난 사진 넣기. 이미 든 사진은 그대로(넣은 시각 유지). `updated_at` 갱신.
pub async fn add_assets(
    conn: &mut PgConnection,
    album_id: Uuid,
    user_id: Uuid,
    asset_ids: &[Uuid],
) -> AppResult<()> {
    sqlx::query!(
        "INSERT INTO album_assets (album_id, asset_id, added_by)
         SELECT $1, asset_id, $2 FROM unnest($3::uuid[]) AS t(asset_id)
         ON CONFLICT DO NOTHING",
        album_id,
        user_id,
        asset_ids
    )
    .execute(&mut *conn)
    .await?;
    sqlx::query!(
        "UPDATE albums SET updated_at = now() WHERE id = $1",
        album_id
    )
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// 없는 연결은 무시. 뺀 사진이 지정 표지면 표지 해제. `updated_at` 갱신.
pub async fn remove_assets(
    conn: &mut PgConnection,
    album_id: Uuid,
    asset_ids: &[Uuid],
) -> AppResult<()> {
    sqlx::query!(
        "DELETE FROM album_assets WHERE album_id = $1 AND asset_id = ANY($2)",
        album_id,
        asset_ids
    )
    .execute(&mut *conn)
    .await?;
    sqlx::query!(
        "UPDATE albums
         SET cover_asset_id = CASE WHEN cover_asset_id = ANY($2) THEN NULL ELSE cover_asset_id END,
             updated_at = now()
         WHERE id = $1",
        album_id,
        asset_ids
    )
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// 앨범 안의 휴지통 아닌 처리 완료 사진이면 `true`. 트랜잭션 안에서 호출 시 커밋까지 사진 완전 삭제 차단.
pub async fn lock_cover_candidate(
    exec: impl PgExecutor<'_>,
    album_id: Uuid,
    asset_id: Uuid,
) -> AppResult<bool> {
    let found = sqlx::query_scalar!(
        "SELECT a.id FROM album_assets aa JOIN assets a ON a.id = aa.asset_id
         WHERE aa.album_id = $1 AND aa.asset_id = $2
           AND a.deleted_at IS NULL AND a.status = 'ready'
         FOR KEY SHARE OF a",
        album_id,
        asset_id
    )
    .fetch_optional(exec)
    .await?;
    Ok(found.is_some())
}

/// `name` 이 `Some` 이면 이름, `cover` 가 `Some` 이면 표지(`None` 포함) 교체. `updated_at` 갱신.
pub async fn update(
    exec: impl PgExecutor<'_>,
    id: Uuid,
    name: Option<&str>,
    cover: Option<Option<Uuid>>,
) -> AppResult<()> {
    sqlx::query!(
        "UPDATE albums
         SET name = COALESCE($2, name),
             cover_asset_id = CASE WHEN $3 THEN $4 ELSE cover_asset_id END,
             updated_at = now()
         WHERE id = $1",
        id,
        name,
        cover.is_some(),
        cover.flatten()
    )
    .execute(exec)
    .await?;
    Ok(())
}

/// 연결은 cascade, 사진은 남음. 지웠으면 `true`.
pub async fn delete(exec: impl PgExecutor<'_>, id: Uuid) -> AppResult<bool> {
    let res = sqlx::query!("DELETE FROM albums WHERE id = $1", id)
        .execute(exec)
        .await?;
    Ok(res.rows_affected() == 1)
}

/// 앨범 안 휴지통 아닌 사진, 촬영 오래된 순. `limit` 만큼 가져오며 호출 측이 +1 로 다음 페이지 판정.
pub async fn list_assets(
    exec: impl PgExecutor<'_>,
    timezone: &str,
    album_id: Uuid,
    cursor: Option<(DateTime<Utc>, Uuid)>,
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
           FROM album_assets aa JOIN assets a ON a.id = aa.asset_id
           WHERE aa.album_id = $2 AND a.deleted_at IS NULL
             AND ($3::timestamptz IS NULL OR (a.taken_at, a.id) > ($3, $4::uuid))
           ORDER BY a.taken_at ASC, a.id ASC
           LIMIT $5"#,
        timezone,
        album_id,
        cursor_ts,
        cursor_id,
        limit,
    )
    .fetch_all(exec)
    .await?;
    Ok(rows)
}
