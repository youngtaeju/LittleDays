//! 이야기/마일스톤 공용 사진 연결. 검사, 교체, 맨 뒤 추가, 조회.
//! 휴지통 사진 연결은 응답에서 제외하되 복원 대비 유지.

use std::collections::HashSet;

use serde::Deserialize;
use sqlx::{PgConnection, PgExecutor};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    assets::{AssetKind, AssetStatus, AssetSummary},
    error::{AppError, AppResult},
};

/// 연결 가능한 사진 수 상한.
pub const MAX_ASSETS: usize = 200;
/// 요약의 미리보기 사진 수.
pub const PREVIEW_LIMIT: i64 = 4;

/// 연결 대상 종류.
#[derive(Debug, Clone, Copy, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LinkKind {
    Story,
    Milestone,
}

impl LinkKind {
    fn as_str(self) -> &'static str {
        match self {
            LinkKind::Story => "story",
            LinkKind::Milestone => "milestone",
        }
    }
}

/// 첫 등장 순서 유지 중복 제거.
pub fn dedup(ids: &[Uuid]) -> Vec<Uuid> {
    let mut seen = HashSet::with_capacity(ids.len());
    ids.iter().copied().filter(|id| seen.insert(*id)).collect()
}

/// 휴지통 아닌 사진 수. 트랜잭션 안에서 호출 시 커밋까지 완전 삭제 차단(연결 쓰기의 FK 위반 방지).
pub async fn lock_visible_assets(exec: impl PgExecutor<'_>, ids: &[Uuid]) -> AppResult<usize> {
    let found = sqlx::query_scalar!(
        "SELECT id FROM assets WHERE id = ANY($1) AND deleted_at IS NULL FOR KEY SHARE",
        ids
    )
    .fetch_all(exec)
    .await?;
    Ok(found.len())
}

/// 중복 제거한 사진 목록. 200장 초과면 400 `request.invalidBody`. 없거나 휴지통이면 404 `asset.notFound`.
pub async fn check_assets(conn: &mut PgConnection, ids: &[Uuid]) -> AppResult<Vec<Uuid>> {
    if ids.len() > MAX_ASSETS {
        return Err(AppError::bad_request("request.invalidBody"));
    }
    let ids = dedup(ids);
    if !ids.is_empty() && lock_visible_assets(conn, &ids).await? != ids.len() {
        return Err(AppError::NotFound("asset.notFound"));
    }
    Ok(ids)
}

/// 휴지통 아닌 사진 연결 전체 교체, 목록 순서가 위치. 휴지통 사진 연결은 복원 대비 유지.
pub async fn replace_assets(
    conn: &mut PgConnection,
    kind: LinkKind,
    owner_id: Uuid,
    asset_ids: &[Uuid],
) -> AppResult<()> {
    // 확인 뒤 휴지통으로 간 사진은 삭제에서 빠져 남음. 위치만 갱신.
    match kind {
        LinkKind::Story => {
            sqlx::query!(
                "DELETE FROM story_assets sa USING assets a
                 WHERE sa.story_id = $1 AND a.id = sa.asset_id AND a.deleted_at IS NULL",
                owner_id
            )
            .execute(&mut *conn)
            .await?;
            sqlx::query!(
                "INSERT INTO story_assets (story_id, asset_id, position)
                 SELECT $1, t.asset_id, (t.n - 1)::int
                 FROM unnest($2::uuid[]) WITH ORDINALITY AS t(asset_id, n)
                 ON CONFLICT (story_id, asset_id) DO UPDATE SET position = EXCLUDED.position",
                owner_id,
                asset_ids
            )
            .execute(&mut *conn)
            .await?;
        }
        LinkKind::Milestone => {
            sqlx::query!(
                "DELETE FROM milestone_assets ma USING assets a
                 WHERE ma.milestone_id = $1 AND a.id = ma.asset_id AND a.deleted_at IS NULL",
                owner_id
            )
            .execute(&mut *conn)
            .await?;
            sqlx::query!(
                "INSERT INTO milestone_assets (milestone_id, asset_id, position)
                 SELECT $1, t.asset_id, (t.n - 1)::int
                 FROM unnest($2::uuid[]) WITH ORDINALITY AS t(asset_id, n)
                 ON CONFLICT (milestone_id, asset_id) DO UPDATE SET position = EXCLUDED.position",
                owner_id,
                asset_ids
            )
            .execute(&mut *conn)
            .await?;
        }
    }
    Ok(())
}

/// 맨 뒤 위치로 연결. 이미 연결된 사진은 그대로.
/// 위치는 휴지통 포함 전체 연결의 최댓값 + 1. 동시 연결의 같은 위치는 (위치, 사진 id) 정렬로 허용.
pub async fn append(
    exec: impl PgExecutor<'_>,
    kind: LinkKind,
    owner_id: Uuid,
    asset_id: Uuid,
) -> AppResult<()> {
    match kind {
        LinkKind::Story => {
            sqlx::query!(
                "INSERT INTO story_assets (story_id, asset_id, position)
             SELECT $1, $2, COALESCE(max(position), -1) + 1 FROM story_assets WHERE story_id = $1
             ON CONFLICT DO NOTHING",
                owner_id,
                asset_id
            )
            .execute(exec)
            .await?
        }
        LinkKind::Milestone => {
            sqlx::query!(
                "INSERT INTO milestone_assets (milestone_id, asset_id, position)
             SELECT $1, $2, COALESCE(max(position), -1) + 1 FROM milestone_assets
             WHERE milestone_id = $1
             ON CONFLICT DO NOTHING",
                owner_id,
                asset_id
            )
            .execute(exec)
            .await?
        }
    };
    Ok(())
}

/// `assets_for` 결과에서 한 대상의 사진만 꺼냄.
pub fn take(rows: &mut Vec<(Uuid, AssetSummary)>, owner_id: Uuid) -> Vec<AssetSummary> {
    let (mine, rest) = std::mem::take(rows)
        .into_iter()
        .partition(|(o, _)| *o == owner_id);
    *rows = rest;
    mine.into_iter().map(|(_, a)| a).collect()
}

/// 대상별 붙인 사진. 휴지통 제외, 위치 순. `limit` 지정 시 대상당 그 수까지.
pub async fn assets_for(
    exec: impl PgExecutor<'_>,
    timezone: &str,
    kind: LinkKind,
    owner_ids: &[Uuid],
    limit: Option<i64>,
) -> AppResult<Vec<(Uuid, AssetSummary)>> {
    let rows = sqlx::query!(
        r#"SELECT p.owner_id AS "owner_id!", p.id AS "id!", p.kind AS "kind!: AssetKind",
                  p.status AS "status!: AssetStatus", p.taken_at AS "taken_at!",
                  p.local_date AS "local_date!", p.width, p.height, p.duration_ms, p.blurhash,
                  p.dominant_color, p.uploaded_by AS "uploaded_by!",
                  COALESCE((SELECT array_agg(b.id ORDER BY b.sort_order, b.created_at, b.id)
                            FROM asset_babies ab JOIN babies b ON b.id = ab.baby_id
                            WHERE ab.asset_id = p.id), '{}') AS "baby_ids!",
                  p.derivatives AS "derivatives!"
           FROM (
               SELECT l.owner_id, l.position, a.id, a.kind, a.status, a.taken_at, a.width,
                      a.height, a.duration_ms, a.blurhash, a.dominant_color, a.uploaded_by,
                      a.derivatives, (a.taken_at AT TIME ZONE $1)::date AS local_date,
                      row_number() OVER (PARTITION BY l.owner_id
                                         ORDER BY l.position, a.id) AS rn
               FROM (
                   SELECT story_id AS owner_id, asset_id, position FROM story_assets
                   WHERE $2 = 'story' AND story_id = ANY($3)
                   UNION ALL
                   SELECT milestone_id, asset_id, position FROM milestone_assets
                   WHERE $2 = 'milestone' AND milestone_id = ANY($3)
               ) l JOIN assets a ON a.id = l.asset_id
               WHERE a.deleted_at IS NULL
           ) p
           WHERE $4::bigint IS NULL OR p.rn <= $4
           ORDER BY p.owner_id, p.position, p.id"#,
        timezone,
        kind.as_str(),
        owner_ids,
        limit,
    )
    .fetch_all(exec)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| {
            (
                r.owner_id,
                AssetSummary {
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
            )
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dedup_keeps_first_order() {
        let a = Uuid::now_v7();
        let b = Uuid::now_v7();
        assert_eq!(dedup(&[b, a, b, a]), [b, a]);
    }
}
