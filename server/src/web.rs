use std::{path::Path, sync::Arc};

use axum::{
    Router,
    extract::Request,
    http::{HeaderValue, Method, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
};
use tower_http::services::ServeDir;

use crate::{app::not_found, error::AppError, state::AppState};

const IMMUTABLE: HeaderValue = HeaderValue::from_static("public, max-age=31536000, immutable");
const NO_CACHE: HeaderValue = HeaderValue::from_static("no-cache");

// SPA 정적 서빙. 경로 정규화/탈출 방지는 ServeDir 에 위임.
pub fn router(dir: &Path) -> Router<AppState> {
    let index = Arc::new(dir.join("index.html"));
    let spa = Router::new().fallback(move |req: Request| spa_fallback(req, index.clone()));
    Router::new()
        .fallback_service(ServeDir::new(dir).fallback(spa))
        .layer(middleware::from_fn(guard_and_cache))
}

// 파일이 없을 때만 진입. 페이지 이동 요청만 index.html, 그 외 404.
async fn spa_fallback(req: Request, index: Arc<std::path::PathBuf>) -> Response {
    let is_read = matches!(*req.method(), Method::GET | Method::HEAD);
    let wants_html = req
        .headers()
        .get(header::ACCEPT)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.contains("text/html"));
    // 해시 자산 경로는 없는 파일에 index.html 을 주지 않음.
    let is_asset = req.uri().path().starts_with("/assets/");
    let has_ext = Path::new(req.uri().path()).extension().is_some();
    if is_read
        && !is_asset
        && (wants_html || !has_ext)
        && let Ok(body) = tokio::fs::read(index.as_path()).await
    {
        return ([(header::CONTENT_TYPE, "text/html; charset=utf-8")], body).into_response();
    }
    AppError::NotFound("server.notFound").into_response()
}

// /api, /s 는 정적 서빙 제외(공유 링크 예약). 해시 자산만 장기 캐시, 나머지는 재검증.
async fn guard_and_cache(req: Request, next: Next) -> Response {
    let path = req.uri().path();
    if is_reserved(path) {
        return not_found().await.into_response();
    }
    let immutable = path.starts_with("/assets/");
    let mut res = next.run(req).await;
    if res.status().is_success() {
        res.headers_mut().insert(
            header::CACHE_CONTROL,
            if immutable { IMMUTABLE } else { NO_CACHE },
        );
    }
    res
}

fn is_reserved(path: &str) -> bool {
    ["/api", "/s"].iter().any(|p| {
        path.strip_prefix(p)
            .is_some_and(|r| r.is_empty() || r.starts_with('/'))
    })
}
