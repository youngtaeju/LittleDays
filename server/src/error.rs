use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("not found: {0}")]
    NotFound(&'static str),
    #[error("conflict: {0}")]
    Conflict(&'static str),
    #[error("forbidden: {0}")]
    Forbidden(&'static str),
    #[error("unauthorized: {0}")]
    Unauthorized(&'static str),
    #[error("gone: {0}")]
    Gone(&'static str),
    #[error("bad request: {key}")]
    BadRequest { key: &'static str, params: Value },
    #[error("database error: {0}")]
    Db(#[from] sqlx::Error),
    #[error("internal error: {0}")]
    Internal(#[from] anyhow::Error),
}

pub type AppResult<T> = Result<T, AppError>;

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, key, params) = match self {
            AppError::NotFound(key) => (StatusCode::NOT_FOUND, key, json!({})),
            AppError::Conflict(key) => (StatusCode::CONFLICT, key, json!({})),
            AppError::Forbidden(key) => (StatusCode::FORBIDDEN, key, json!({})),
            AppError::Unauthorized(key) => (StatusCode::UNAUTHORIZED, key, json!({})),
            AppError::Gone(key) => (StatusCode::GONE, key, json!({})),
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
