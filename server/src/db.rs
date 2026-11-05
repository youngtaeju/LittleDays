use sqlx::{PgPool, postgres::PgPoolOptions};

pub async fn connect(url: &str) -> sqlx::Result<PgPool> {
    PgPoolOptions::new().max_connections(10).connect(url).await
}

pub async fn migrate(pool: &PgPool) -> sqlx::Result<()> {
    sqlx::migrate!("./migrations").run(pool).await?;
    Ok(())
}
