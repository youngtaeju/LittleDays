mod common;

use axum_test::TestServer;
use littledays::{app::build_router, config::Config, state::AppState};
use sqlx::PgPool;

const CSP: &str = "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";

fn assert_headers(res: &axum_test::TestResponse, path: &str) {
    for (name, value) in [
        ("content-security-policy", CSP),
        ("x-content-type-options", "nosniff"),
        ("referrer-policy", "same-origin"),
        (
            "permissions-policy",
            "camera=(), microphone=(), geolocation=()",
        ),
    ] {
        assert_eq!(res.header(name), value, "{path} {name}");
    }
}

#[sqlx::test]
async fn headers_on_api_and_static(pool: PgPool) {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("index.html"), "<title>t</title>").unwrap();
    std::fs::create_dir(dir.path().join("assets")).unwrap();
    std::fs::write(dir.path().join("assets/x.js"), "1").unwrap();
    let config = Config {
        web_dir: Some(dir.path().to_path_buf()),
        ..common::test_config()
    };
    let server = TestServer::new(build_router(AppState::new(pool, config))).unwrap();

    for path in ["/api/health", "/api/nope", "/", "/assets/x.js"] {
        assert_headers(&server.get(path).await, path);
    }
    // 405
    assert_headers(&server.post("/api/health").await, "POST /api/health");
}
