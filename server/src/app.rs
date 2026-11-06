use axum::{
    Json, Router, body::Body, extract::MatchedPath, http::Request, middleware, routing::get,
};
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
        .layer(
            // 쿼리의 media token, path 의 초대 토큰이 로그에 남지 않게 라우트 템플릿만 기록.
            TraceLayer::new_for_http().make_span_with(|req: &Request<Body>| {
                let route = req
                    .extensions()
                    .get::<MatchedPath>()
                    .map_or("-", MatchedPath::as_str);
                tracing::debug_span!("request", method = %req.method(), route)
            }),
        )
        .with_state(state)
}

async fn not_found() -> AppError {
    AppError::NotFound("server.notFound")
}

async fn method_not_allowed() -> AppError {
    AppError::MethodNotAllowed("server.methodNotAllowed")
}
