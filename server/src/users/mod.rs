use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

pub mod queries;
pub mod reset;
pub mod routes;

#[derive(Debug, Clone, Copy, PartialEq, Eq, sqlx::Type, Serialize, Deserialize, ToSchema)]
#[sqlx(type_name = "user_role", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Owner,
    Guardian,
    Family,
}

#[derive(Debug, Clone, sqlx::FromRow, Serialize, ToSchema)]
pub struct User {
    pub id: Uuid,
    pub username: String,
    pub display_name: String,
    pub role: Role,
    #[schema(required = true)]
    pub email: Option<String>,
    pub locale: String,
    pub created_at: DateTime<Utc>,
    #[schema(required = true)]
    pub disabled_at: Option<DateTime<Utc>>,
}

/// 로그인 검증용. API 응답에 직접 노출 금지.
#[derive(Debug, Clone)]
pub struct UserRecord {
    pub user: User,
    pub password_hash: String,
}

pub struct NewUser {
    pub username: String,
    pub password_hash: String,
    pub display_name: String,
    pub role: Role,
    pub email: Option<String>,
    pub locale: String,
}

/// 본인 프로필 부분 갱신. `None` 은 유지, `email: Some(None)` 은 삭제.
pub struct ProfileUpdate {
    pub display_name: Option<String>,
    pub locale: Option<String>,
    pub email: Option<Option<String>>,
}
