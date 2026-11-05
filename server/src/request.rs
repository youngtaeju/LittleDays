use axum::extract::{
    FromRequest, FromRequestParts,
    rejection::{JsonRejection, PathRejection},
};
use serde_json::json;

use crate::error::AppError;

/// 본문 파싱 실패를 표준 에러 응답으로 변환하는 `axum::Json` 대체.
#[derive(FromRequest)]
#[from_request(via(axum::Json), rejection(AppError))]
pub struct Json<T>(pub T);

impl From<JsonRejection> for AppError {
    fn from(rejection: JsonRejection) -> Self {
        tracing::debug!(error = %rejection, "invalid request body");
        AppError::BadRequest {
            key: "request.invalidBody",
            params: json!({}),
        }
    }
}

/// 경로 파라미터 파싱 실패를 표준 에러 응답으로 변환하는 `axum::extract::Path` 대체.
#[derive(FromRequestParts)]
#[from_request(via(axum::extract::Path), rejection(AppError))]
pub struct Path<T>(pub T);

impl From<PathRejection> for AppError {
    fn from(rejection: PathRejection) -> Self {
        tracing::debug!(error = %rejection, "invalid path parameter");
        AppError::BadRequest {
            key: "request.invalidPath",
            params: json!({}),
        }
    }
}
