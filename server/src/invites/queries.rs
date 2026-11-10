use chrono::{DateTime, Utc};
use sqlx::PgExecutor;
use uuid::Uuid;

use super::{Invite, InviteStatus, NewInvite};
use crate::{
    auth::token,
    error::{AppError, AppResult},
    users::Role,
};

/// `now`: DB 시각. 만료 판정을 `expires_at` 과 같은 시계로.
struct InviteRow {
    id: Uuid,
    role: Role,
    created_by: Uuid,
    created_at: DateTime<Utc>,
    expires_at: DateTime<Utc>,
    used_by: Option<Uuid>,
    used_at: Option<DateTime<Utc>>,
    revoked_at: Option<DateTime<Utc>>,
    now: DateTime<Utc>,
}

impl From<InviteRow> for Invite {
    fn from(r: InviteRow) -> Self {
        Invite {
            status: InviteStatus::at(r.expires_at, r.used_at, r.revoked_at, r.now),
            id: r.id,
            role: r.role,
            created_by: r.created_by,
            created_at: r.created_at,
            expires_at: r.expires_at,
            used_by: r.used_by,
            used_at: r.used_at,
            revoked_at: r.revoked_at,
        }
    }
}

/// 원문 토큰과 초대 반환. DB 에는 SHA-256 해시만 저장.
pub async fn create(exec: impl PgExecutor<'_>, new: NewInvite) -> AppResult<(String, Invite)> {
    let (raw, token_hash) = token::generate();
    let row = sqlx::query_as!(
        InviteRow,
        r#"INSERT INTO invites (id, token_hash, role, created_by, expires_at)
           VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5))
           RETURNING id, role AS "role: Role", created_by, created_at, expires_at,
                     used_by, used_at, revoked_at, now() AS "now!""#,
        Uuid::now_v7(),
        token_hash,
        new.role as Role,
        new.created_by,
        new.expires_in.num_seconds() as f64,
    )
    .fetch_one(exec)
    .await?;
    Ok((raw, row.into()))
}

pub async fn find_by_raw(exec: impl PgExecutor<'_>, raw: &str) -> AppResult<Option<Invite>> {
    let row = sqlx::query_as!(
        InviteRow,
        r#"SELECT id, role AS "role: Role", created_by, created_at, expires_at,
                  used_by, used_at, revoked_at, now() AS "now!"
           FROM invites WHERE token_hash = $1"#,
        token::hash(raw),
    )
    .fetch_optional(exec)
    .await?;
    Ok(row.map(Into::into))
}

/// 초대한 사용자 표시 이름.
pub async fn inviter_display_name(exec: impl PgExecutor<'_>, user_id: Uuid) -> AppResult<String> {
    let name = sqlx::query_scalar!("SELECT display_name FROM users WHERE id = $1", user_id)
        .fetch_one(exec)
        .await?;
    Ok(name)
}

/// 행 잠금 조회. 트랜잭션 내 수락 경합 차단용.
pub async fn find_for_update(exec: impl PgExecutor<'_>, id: Uuid) -> AppResult<Option<Invite>> {
    let row = sqlx::query_as!(
        InviteRow,
        r#"SELECT id, role AS "role: Role", created_by, created_at, expires_at,
                  used_by, used_at, revoked_at, now() AS "now!"
           FROM invites WHERE id = $1 FOR UPDATE"#,
        id,
    )
    .fetch_optional(exec)
    .await?;
    Ok(row.map(Into::into))
}

/// 최신순.
pub async fn list(exec: impl PgExecutor<'_>) -> AppResult<Vec<Invite>> {
    let rows = sqlx::query_as!(
        InviteRow,
        r#"SELECT id, role AS "role: Role", created_by, created_at, expires_at,
                  used_by, used_at, revoked_at, now() AS "now!"
           FROM invites ORDER BY created_at DESC, id DESC"#,
    )
    .fetch_all(exec)
    .await?;
    Ok(rows.into_iter().map(Into::into).collect())
}

/// 없음 → 404, 사용됨 → 409. 재회수는 최초 시각 유지(멱등).
pub async fn revoke(exec: impl PgExecutor<'_>, id: Uuid) -> AppResult<()> {
    // 단일 UPDATE. 동시 수락 커밋 시 최신 행 기준 재평가라 사용된 초대 회수 불가.
    let used = sqlx::query_scalar!(
        r#"UPDATE invites
           SET revoked_at = CASE WHEN used_at IS NULL THEN coalesce(revoked_at, now())
                                 ELSE revoked_at END
           WHERE id = $1
           RETURNING used_at IS NOT NULL AS "used!""#,
        id,
    )
    .fetch_optional(exec)
    .await?;
    match used {
        None => Err(AppError::NotFound("invite.notFound")),
        Some(true) => Err(AppError::conflict("invite.used")),
        Some(false) => Ok(()),
    }
}

pub async fn mark_used(exec: impl PgExecutor<'_>, id: Uuid, user_id: Uuid) -> AppResult<()> {
    sqlx::query!(
        "UPDATE invites SET used_by = $2, used_at = now() WHERE id = $1",
        id,
        user_id,
    )
    .execute(exec)
    .await?;
    Ok(())
}
