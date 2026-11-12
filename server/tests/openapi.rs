mod common;

use common::test_server;
use serde_json::Value;
use sqlx::PgPool;

#[sqlx::test]
async fn openapi_matches_served_document(pool: PgPool) {
    let server = test_server(pool).await;
    let served: Value = server.get("/api/openapi.json").await.json();
    let local = serde_json::to_value(littledays::app::openapi()).expect("serialize");
    assert_eq!(served, local);
    let paths = local["paths"].as_object().expect("paths");
    assert!(paths.contains_key("/api/assets"));
    assert!(paths.contains_key("/api/uploads/{id}/finalize"));
}

#[test]
fn operation_ids_unique() {
    let doc = serde_json::to_value(littledays::app::openapi()).expect("serialize");
    let mut seen = std::collections::HashSet::new();
    for (path, item) in doc["paths"].as_object().expect("paths") {
        for (method, op) in item.as_object().expect("item") {
            let id = op["operationId"].as_str().expect("operationId");
            assert!(
                seen.insert(id.to_string()),
                "중복 operationId {id} ({method} {path})"
            );
        }
    }
}
