use std::time::Duration;

use axum::{Json, extract::State, http::StatusCode};
use serde::Serialize;
use utoipa::ToSchema;
use utoipa_axum::{router::OpenApiRouter, routes};

use crate::state::AppState;

#[derive(Serialize, ToSchema)]
pub struct HealthResponse {
    status: &'static str,
    db: bool,
}

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(health))
}

#[utoipa::path(
    get,
    path = "/api/health",
    responses(
        (status = 200, description = "서버와 DB 정상", body = HealthResponse),
        (status = 503, description = "DB 연결 실패", body = HealthResponse),
    )
)]
async fn health(State(state): State<AppState>) -> (StatusCode, Json<HealthResponse>) {
    let probe = tokio::time::timeout(
        Duration::from_secs(2),
        sqlx::query_scalar!("SELECT 1").fetch_one(&state.pool),
    )
    .await;
    match probe {
        Ok(Ok(_)) => (
            StatusCode::OK,
            Json(HealthResponse {
                status: "ok",
                db: true,
            }),
        ),
        Ok(Err(e)) => {
            tracing::warn!(error = %e, "health check: db query failed");
            degraded()
        }
        Err(_) => {
            tracing::warn!("health check: db query timed out");
            degraded()
        }
    }
}

fn degraded() -> (StatusCode, Json<HealthResponse>) {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(HealthResponse {
            status: "degraded",
            db: false,
        }),
    )
}
