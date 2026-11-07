use axum::{
    Json, Router, body::Body, extract::MatchedPath, http::Request, middleware, routing::get,
};
use tower_http::trace::TraceLayer;
use utoipa::OpenApi;
use utoipa_axum::router::OpenApiRouter;

use crate::{
    assets, auth, babies, error::AppError, invites, openapi::ApiDoc, routes, settings,
    state::AppState, uploads, users, web,
};

// 라우터 트리와 OpenAPI 문서의 단일 출처.
fn api_router() -> OpenApiRouter<AppState> {
    OpenApiRouter::with_openapi(ApiDoc::openapi())
        .merge(routes::health::router())
        .merge(assets::files::router())
        .merge(assets::routes::router())
        .merge(auth::routes::router())
        .merge(babies::routes::router())
        .merge(invites::routes::router())
        .merge(settings::routes::router())
        .merge(uploads::finalize::router())
        .merge(uploads::tus::router())
        .merge(users::routes::router())
}

// DB, 환경 변수 없이 문서만 생성.
pub fn openapi() -> utoipa::openapi::OpenApi {
    api_router().split_for_parts().1
}

pub fn build_router(state: AppState) -> Router {
    let (api, openapi) = api_router().split_for_parts();

    let api = api
        .route("/api/openapi.json", get(|| async move { Json(openapi) }))
        .method_not_allowed_fallback(method_not_allowed);
    let app = match &state.config.web_dir {
        Some(dir) => api.merge(web::router(dir)),
        None => api.fallback(not_found),
    };

    app.layer(middleware::from_fn(auth::extract::csrf_layer))
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

pub(crate) async fn not_found() -> AppError {
    AppError::NotFound("server.notFound")
}

async fn method_not_allowed() -> AppError {
    AppError::MethodNotAllowed("server.methodNotAllowed")
}
