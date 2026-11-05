use axum::{Json, Router, middleware, routing::get};
use tower_http::trace::TraceLayer;
use utoipa::OpenApi;
use utoipa_axum::router::OpenApiRouter;

use crate::{
    auth, error::AppError, invites, openapi::ApiDoc, routes, settings, state::AppState, users,
};

pub fn build_router(state: AppState) -> Router {
    let (api, openapi) = OpenApiRouter::with_openapi(ApiDoc::openapi())
        .merge(routes::health::router())
        .merge(auth::routes::router())
        .merge(invites::routes::router())
        .merge(settings::routes::router())
        .merge(users::routes::router())
        .split_for_parts();

    api.route("/api/openapi.json", get(|| async move { Json(openapi) }))
        .method_not_allowed_fallback(method_not_allowed)
        .fallback(not_found)
        .layer(middleware::from_fn(auth::extract::csrf_layer))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

async fn not_found() -> AppError {
    AppError::NotFound("server.notFound")
}

async fn method_not_allowed() -> AppError {
    AppError::MethodNotAllowed("server.methodNotAllowed")
}
