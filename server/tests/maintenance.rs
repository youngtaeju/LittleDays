mod common;

use common::media_app;
use littledays::users::Role;
use littledays::{auth::session, maintenance};
use sqlx::PgPool;

#[sqlx::test]
async fn expired_sessions_are_removed(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let (_, expired_id) = session::create(&pool, app.user.id, None)
        .await
        .expect("session");
    sqlx::query!(
        "UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE id = $1",
        expired_id,
    )
    .execute(&pool)
    .await
    .expect("expire");

    maintenance::run_once(&app.state).await.expect("run_once");

    let remaining = sqlx::query_scalar!("SELECT id FROM sessions")
        .fetch_all(&pool)
        .await
        .expect("list");
    assert_eq!(remaining.len(), 1);
    assert_ne!(remaining[0], expired_id);
    app.server.get("/api/auth/me").await.assert_status_ok();
}

#[sqlx::test]
async fn spawn_stops_on_shutdown_signal(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let (tx, rx) = tokio::sync::watch::channel(false);
    let handle = maintenance::spawn(app.state.clone(), rx);

    tx.send(true).expect("send");

    tokio::time::timeout(std::time::Duration::from_secs(1), handle)
        .await
        .expect("종료 지연")
        .expect("join");
}
