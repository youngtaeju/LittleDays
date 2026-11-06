use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;
use serde_json::{Value, json};
use utoipa::ToSchema;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("not found: {0}")]
    NotFound(&'static str),
    #[error("conflict: {key}")]
    Conflict { key: &'static str, params: Value },
    #[error("forbidden: {0}")]
    Forbidden(&'static str),
    #[error("unauthorized: {0}")]
    Unauthorized(&'static str),
    #[error("method not allowed: {0}")]
    MethodNotAllowed(&'static str),
    #[error("gone: {0}")]
    Gone(&'static str),
    #[error("precondition failed: {0}")]
    PreconditionFailed(&'static str),
    #[error("payload too large: {0}")]
    PayloadTooLarge(&'static str),
    #[error("unsupported media type: {0}")]
    UnsupportedMediaType(&'static str),
    #[error("bad request: {key}")]
    BadRequest { key: &'static str, params: Value },
    #[error("database error: {0}")]
    Db(#[from] sqlx::Error),
    #[error("internal error: {0}")]
    Internal(#[from] anyhow::Error),
}

pub type AppResult<T> = Result<T, AppError>;

impl AppError {
    /// 파라미터 없는 400.
    pub fn bad_request(key: &'static str) -> Self {
        AppError::BadRequest {
            key,
            params: json!({}),
        }
    }

    /// 파라미터 없는 409.
    pub fn conflict(key: &'static str) -> Self {
        AppError::Conflict {
            key,
            params: json!({}),
        }
    }
}

/// 에러 응답 본문 스키마(OpenAPI 전용). 실제 직렬화는 `IntoResponse`.
#[derive(Serialize, ToSchema)]
pub struct ErrorBody {
    /// i18n 키. 예: `auth.required`.
    error: String,
    /// 번역 파라미터.
    #[schema(value_type = Object)]
    params: Value,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, key, params) = match self {
            AppError::NotFound(key) => (StatusCode::NOT_FOUND, key, json!({})),
            AppError::Conflict { key, params } => (StatusCode::CONFLICT, key, params),
            AppError::Forbidden(key) => (StatusCode::FORBIDDEN, key, json!({})),
            AppError::Unauthorized(key) => (StatusCode::UNAUTHORIZED, key, json!({})),
            AppError::MethodNotAllowed(key) => (StatusCode::METHOD_NOT_ALLOWED, key, json!({})),
            AppError::Gone(key) => (StatusCode::GONE, key, json!({})),
            AppError::PreconditionFailed(key) => (StatusCode::PRECONDITION_FAILED, key, json!({})),
            AppError::PayloadTooLarge(key) => (StatusCode::PAYLOAD_TOO_LARGE, key, json!({})),
            AppError::UnsupportedMediaType(key) => {
                (StatusCode::UNSUPPORTED_MEDIA_TYPE, key, json!({}))
            }
            AppError::BadRequest { key, params } => (StatusCode::BAD_REQUEST, key, params),
            AppError::Db(e) => {
                tracing::error!(error = %e, "database error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "server.internal",
                    json!({}),
                )
            }
            AppError::Internal(e) => {
                tracing::error!(error = ?e, "internal error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "server.internal",
                    json!({}),
                )
            }
        };
        (status, Json(json!({ "error": key, "params": params }))).into_response()
    }
}
