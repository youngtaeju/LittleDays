mod common;

#[sqlx::test(migrations = "./migrations")]
async fn health_reports_db_ok(pool: sqlx::PgPool) {
    let server = common::test_server(pool).await;
    let res = server.get("/api/health").await;
    res.assert_status_ok();
    res.assert_json(&serde_json::json!({ "status": "ok", "db": true }));
}

#[sqlx::test(migrations = "./migrations")]
async fn health_degraded_when_pool_closed(pool: sqlx::PgPool) {
    let server = common::test_server(pool.clone()).await;
    pool.close().await;
    let res = server.get("/api/health").await;
    res.assert_status(axum::http::StatusCode::SERVICE_UNAVAILABLE);
    res.assert_json(&serde_json::json!({ "status": "degraded", "db": false }));
}

#[sqlx::test(migrations = "./migrations")]
async fn openapi_json_is_served(pool: sqlx::PgPool) {
    let server = common::test_server(pool).await;
    let res = server.get("/api/openapi.json").await;
    res.assert_status_ok();
    let doc: serde_json::Value = res.json();
    assert!(doc["paths"]["/api/health"]["get"].is_object());
}

#[sqlx::test(migrations = "./migrations")]
async fn unknown_path_returns_standard_404(pool: sqlx::PgPool) {
    let server = common::test_server(pool).await;
    let res = server.get("/nope").await;
    res.assert_status_not_found();
    res.assert_json(&serde_json::json!({ "error": "server.notFound", "params": {} }));
}

#[sqlx::test(migrations = "./migrations")]
async fn wrong_method_returns_standard_405(pool: sqlx::PgPool) {
    let server = common::test_server(pool).await;
    let res = server.post("/api/health").await;
    res.assert_status(axum::http::StatusCode::METHOD_NOT_ALLOWED);
    res.assert_json(&serde_json::json!({ "error": "server.methodNotAllowed", "params": {} }));
}
