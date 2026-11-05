use chrono::{DateTime, Duration, Utc};
use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    users::Role,
};

pub mod queries;
pub mod routes;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum InviteStatus {
    Active,
    Expired,
    Used,
    Revoked,
}

impl InviteStatus {
    /// 우선순위 revoked > used > expired > active.
    /// 회수·사용은 명시적 조치라 만료보다 우선. 사용 후 회수는 불가라 두 값 공존 없음.
    fn at(
        expires_at: DateTime<Utc>,
        used_at: Option<DateTime<Utc>>,
        revoked_at: Option<DateTime<Utc>>,
        now: DateTime<Utc>,
    ) -> Self {
        if revoked_at.is_some() {
            InviteStatus::Revoked
        } else if used_at.is_some() {
            InviteStatus::Used
        } else if expires_at <= now {
            InviteStatus::Expired
        } else {
            InviteStatus::Active
        }
    }
}

/// 토큰 해시 미포함.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct Invite {
    pub id: Uuid,
    pub role: Role,
    pub created_by: Uuid,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub used_by: Option<Uuid>,
    pub used_at: Option<DateTime<Utc>>,
    pub revoked_at: Option<DateTime<Utc>>,
    /// 조회 시점 DB 시각 기준 계산값.
    pub status: InviteStatus,
}

impl Invite {
    /// 수락·미리보기 가능 여부. 불가 시 410.
    pub fn ensure_active(&self) -> AppResult<()> {
        match self.status {
            InviteStatus::Active => Ok(()),
            InviteStatus::Expired => Err(AppError::Gone("invite.expired")),
            InviteStatus::Used => Err(AppError::Gone("invite.used")),
            InviteStatus::Revoked => Err(AppError::Gone("invite.revoked")),
        }
    }
}

pub struct NewInvite {
    pub role: Role,
    pub created_by: Uuid,
    pub expires_in: Duration,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_precedence() {
        let now = Utc::now();
        let past = now - Duration::hours(1);
        let future = now + Duration::hours(1);
        let at = |expires_at, used_at, revoked_at| {
            InviteStatus::at(expires_at, used_at, revoked_at, now)
        };

        assert_eq!(at(future, None, None), InviteStatus::Active);
        assert_eq!(at(now, None, None), InviteStatus::Expired);
        assert_eq!(at(past, None, None), InviteStatus::Expired);
        assert_eq!(at(past, Some(past), None), InviteStatus::Used);
        assert_eq!(at(future, Some(past), None), InviteStatus::Used);
        assert_eq!(at(past, None, Some(past)), InviteStatus::Revoked);
        assert_eq!(at(future, Some(past), Some(past)), InviteStatus::Revoked);
    }
}
