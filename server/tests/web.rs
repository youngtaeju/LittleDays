mod common;

use axum::http::{StatusCode, header};
use axum_test::TestServer;
use littledays::{app::build_router, config::Config, state::AppState};
use sqlx::PgPool;
use tempfile::TempDir;

fn web_dir() -> TempDir {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join("index.html"),
        "<!doctype html><title>t</title>",
    )
    .unwrap();
    std::fs::create_dir(dir.path().join("assets")).unwrap();
    std::fs::write(dir.path().join("assets/app-abc.js"), "console.log(1)").unwrap();
    std::fs::write(dir.path().join("sw.js"), "// sw").unwrap();
    dir
}

fn server(pool: PgPool, web_dir: Option<&TempDir>) -> TestServer {
    let config = Config {
        web_dir: web_dir.map(|d| d.path().to_path_buf()),
        ..common::test_config()
    };
    TestServer::new(build_router(AppState::new(pool, config))).unwrap()
}

#[sqlx::test]
async fn serves_index_for_spa_routes(pool: PgPool) {
    let dir = web_dir();
    let server = server(pool, Some(&dir));
    for path in ["/", "/photo/0190abcd"] {
        let res = server
            .get(path)
            .add_header(header::ACCEPT, "text/html")
            .await;
        res.assert_status_ok();
        assert!(res.text().contains("<title>t</title>"), "{path}");
        assert_eq!(res.header(header::CACHE_CONTROL), "no-cache", "{path}");
    }
    // Accept 없이도 확장자 없는 경로는 index.html.
    server.get("/timeline").await.assert_status_ok();
    // 확장자 있어도 Accept 가 html 이면 index.html.
    server
        .get("/photo/a.b")
        .add_header(header::ACCEPT, "text/html")
        .await
        .assert_status_ok();
}

#[sqlx::test]
async fn static_cache_headers(pool: PgPool) {
    let dir = web_dir();
    let server = server(pool, Some(&dir));
    let res = server.get("/assets/app-abc.js").await;
    res.assert_status_ok();
    assert!(
        res.header(header::CACHE_CONTROL)
            .to_str()
            .unwrap()
            .contains("immutable")
    );
    let res = server.get("/sw.js").await;
    res.assert_status_ok();
    assert_eq!(res.header(header::CACHE_CONTROL), "no-cache");
}

#[sqlx::test]
async fn api_paths_stay_json_404(pool: PgPool) {
    let dir = web_dir();
    let server = server(pool, Some(&dir));
    for path in ["/api/nope", "/api"] {
        let res = server
            .get(path)
            .add_header(header::ACCEPT, "text/html")
            .await;
        res.assert_status(StatusCode::NOT_FOUND);
        assert_eq!(res.json::<serde_json::Value>()["error"], "server.notFound");
    }
}

#[sqlx::test]
async fn share_prefix_reserved(pool: PgPool) {
    let dir = web_dir();
    let server = server(pool, Some(&dir));
    for path in ["/s/abc", "/s"] {
        let res = server
            .get(path)
            .add_header(header::ACCEPT, "text/html")
            .await;
        res.assert_status(StatusCode::NOT_FOUND);
        assert_eq!(res.json::<serde_json::Value>()["error"], "server.notFound");
    }
    // 접두만 같은 경로는 SPA 라우트.
    server.get("/settings").await.assert_status_ok();
}

#[sqlx::test]
async fn missing_static_file_404(pool: PgPool) {
    let dir = web_dir();
    let server = server(pool, Some(&dir));
    server
        .get("/missing.js")
        .await
        .assert_status(StatusCode::NOT_FOUND);
    server
        .get("/assets/missing-1.js")
        .await
        .assert_status(StatusCode::NOT_FOUND);
}

#[sqlx::test]
async fn traversal_blocked(pool: PgPool) {
    let dir = web_dir();
    let server = server(pool, Some(&dir));
    for path in [
        "/../Cargo.toml",
        "/%2e%2e/Cargo.toml",
        "/assets/..%2f..%2fCargo.toml",
    ] {
        let res = server.get(path).await;
        assert!(
            !res.text().contains("[package]"),
            "{path}: {}",
            res.status_code()
        );
    }
}

#[sqlx::test]
async fn no_web_dir_keeps_json_404(pool: PgPool) {
    let server = server(pool, None);
    let res = server.get("/photo/x").await;
    res.assert_status(StatusCode::NOT_FOUND);
    assert_eq!(res.json::<serde_json::Value>()["error"], "server.notFound");
}

#[sqlx::test]
async fn missing_asset_is_404_without_immutable(pool: PgPool) {
    let dir = web_dir();
    let server = server(pool, Some(&dir));
    let res = server
        .get("/assets/missing.js")
        .add_header(header::ACCEPT, "text/html")
        .await;
    res.assert_status(StatusCode::NOT_FOUND);
    assert!(res.maybe_header(header::CACHE_CONTROL).is_none());
}
