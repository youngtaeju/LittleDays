use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

pub mod queries;
pub mod routes;

#[derive(Debug, Clone, Copy, PartialEq, Eq, sqlx::Type, Serialize, Deserialize, ToSchema)]
#[sqlx(type_name = "baby_sex", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum Sex {
    Female,
    Male,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct Baby {
    pub id: Uuid,
    pub name: String,
    pub birth_date: NaiveDate,
    #[schema(required = true)]
    pub sex: Option<Sex>,
    #[schema(required = true)]
    pub avatar_asset_id: Option<Uuid>,
    pub sort_order: i32,
}

/// 생성·전체 교체 공용 입력. 이름은 검증·정규화 완료 상태.
pub struct BabyInput {
    pub name: String,
    pub birth_date: NaiveDate,
    pub sex: Option<Sex>,
}
