use axum::{Router, http::HeaderValue};
use tower_http::set_header::SetResponseHeaderLayer;

const CSP: &str = "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";

// 모든 응답에 보안 헤더 설정. 핸들러가 먼저 넣은 헤더는 유지.
pub fn apply<S: Clone + Send + Sync + 'static>(router: Router<S>) -> Router<S> {
    let set = |name: &'static str, value: &'static str| {
        SetResponseHeaderLayer::if_not_present(
            axum::http::HeaderName::from_static(name),
            HeaderValue::from_static(value),
        )
    };
    router
        .layer(set("content-security-policy", CSP))
        .layer(set("x-content-type-options", "nosniff"))
        .layer(set("referrer-policy", "same-origin"))
        .layer(set(
            "permissions-policy",
            "camera=(), microphone=(), geolocation=()",
        ))
}
