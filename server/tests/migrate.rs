#[sqlx::test(migrations = "./migrations")]
async fn migrations_apply_and_tables_exist(pool: sqlx::PgPool) {
    let n: i64 = sqlx::query_scalar("SELECT count(*) FROM information_schema.tables WHERE table_name IN ('users','sessions','invites','settings')")
        .fetch_one(&pool).await.unwrap();
    assert_eq!(n, 4);
}
