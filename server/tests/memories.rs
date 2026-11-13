mod common;

use chrono::{DateTime, Datelike, NaiveDate, Utc};
use common::{AssetSeed, insert_asset, server_as};
use littledays::{
    babies::{self, BabyInput},
    memories::{MemoryKind, pick},
    settings,
    users::Role,
};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

fn d(s: &str) -> NaiveDate {
    s.parse().unwrap()
}

fn noon(date: NaiveDate) -> DateTime<Utc> {
    date.and_hms_opt(12, 0, 0).unwrap().and_utc()
}

async fn setup(pool: &PgPool) -> Uuid {
    settings::queries::set(pool, "timezone", json!("UTC"))
        .await
        .unwrap();
    let (_, user) = server_as(pool, "mom", Role::Owner).await;
    user.id
}

async fn photo_on(pool: &PgPool, by: Uuid, date: NaiveDate) -> Uuid {
    let mut s = AssetSeed::photo(by);
    s.taken_at = noon(date);
    insert_asset(pool, s).await
}

async fn baby(pool: &PgPool, name: &str) -> Uuid {
    babies::queries::create(
        pool,
        BabyInput {
            name: name.to_string(),
            birth_date: d("2024-01-01"),
            sex: None,
        },
    )
    .await
    .unwrap()
    .id
}

async fn tag(pool: &PgPool, asset: Uuid, baby: Uuid, by: Uuid) {
    sqlx::query!(
        "INSERT INTO asset_babies (asset_id, baby_id, tagged_by) VALUES ($1, $2, $3)",
        asset,
        baby,
        by
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn story_on(pool: &PgPool, author: Uuid, date: NaiveDate) {
    sqlx::query!(
        "INSERT INTO stories (id, author_id, entry_date, body) VALUES ($1, $2, $3, 'story')",
        Uuid::now_v7(),
        author,
        date
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn milestone_on(pool: &PgPool, baby: Uuid, by: Uuid, date: NaiveDate) {
    sqlx::query!(
        "INSERT INTO milestones (id, baby_id, custom_label, achieved_on, created_by)
         VALUES ($1, $2, 'first', $3, $4)",
        Uuid::now_v7(),
        baby,
        date,
        by
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn picked(
    pool: &PgPool,
    today: &str,
    baby_id: Option<Uuid>,
) -> Option<(MemoryKind, i32, NaiveDate)> {
    pick(pool, "UTC", d(today), baby_id).await.unwrap()
}

#[sqlx::test]
async fn years_first(pool: PgPool) {
    let me = setup(&pool).await;
    photo_on(&pool, me, d("2026-05-10")).await;
    photo_on(&pool, me, d("2027-02-10")).await;
    assert_eq!(
        picked(&pool, "2027-05-10", None).await,
        Some((MemoryKind::Years, 1, d("2026-05-10")))
    );
}

#[sqlx::test]
async fn nearest_year(pool: PgPool) {
    let me = setup(&pool).await;
    photo_on(&pool, me, d("2024-05-10")).await;
    photo_on(&pool, me, d("2025-05-10")).await;
    assert_eq!(
        picked(&pool, "2027-05-10", None).await,
        Some((MemoryKind::Years, 2, d("2025-05-10")))
    );
}

#[sqlx::test]
async fn nearest_month(pool: PgPool) {
    let me = setup(&pool).await;
    photo_on(&pool, me, d("2027-03-10")).await;
    photo_on(&pool, me, d("2026-12-10")).await;
    assert_eq!(
        picked(&pool, "2027-05-10", None).await,
        Some((MemoryKind::Months, 2, d("2027-03-10")))
    );
}

#[sqlx::test]
async fn month_window_limits(pool: PgPool) {
    let me = setup(&pool).await;
    // 13개월 전 다른 월은 후보 아님
    photo_on(&pool, me, d("2026-04-10")).await;
    assert_eq!(picked(&pool, "2027-05-10", None).await, None);
    // 12개월 전은 년(1)으로만
    photo_on(&pool, me, d("2026-05-10")).await;
    assert_eq!(
        picked(&pool, "2027-05-10", None).await,
        Some((MemoryKind::Years, 1, d("2026-05-10")))
    );
}

#[sqlx::test]
async fn month_end_skips(pool: PgPool) {
    let me = setup(&pool).await;
    photo_on(&pool, me, d("2027-02-28")).await;
    assert_eq!(picked(&pool, "2027-03-31", None).await, None);
    photo_on(&pool, me, d("2026-12-31")).await;
    assert_eq!(
        picked(&pool, "2027-03-31", None).await,
        Some((MemoryKind::Months, 3, d("2026-12-31")))
    );
}

#[sqlx::test]
async fn leap_day(pool: PgPool) {
    let me = setup(&pool).await;
    photo_on(&pool, me, d("2027-02-28")).await;
    assert_eq!(picked(&pool, "2028-02-29", None).await, None);
    photo_on(&pool, me, d("2024-02-29")).await;
    assert_eq!(
        picked(&pool, "2028-02-29", None).await,
        Some((MemoryKind::Years, 4, d("2024-02-29")))
    );
}

#[sqlx::test]
async fn baby_filter(pool: PgPool) {
    let me = setup(&pool).await;
    let a = baby(&pool, "a").await;
    let b = baby(&pool, "b").await;
    let on_b = photo_on(&pool, me, d("2026-05-10")).await;
    tag(&pool, on_b, b, me).await;
    assert_eq!(picked(&pool, "2027-05-10", Some(a)).await, None);
    assert!(picked(&pool, "2027-05-10", Some(b)).await.is_some());
    assert!(picked(&pool, "2027-05-10", None).await.is_some());
}

#[sqlx::test]
async fn trash_only_day_excluded(pool: PgPool) {
    let me = setup(&pool).await;
    let mut s = AssetSeed::photo(me);
    s.taken_at = noon(d("2026-05-10"));
    s.deleted_at = Some(Utc::now());
    insert_asset(&pool, s).await;
    assert_eq!(picked(&pool, "2027-05-10", None).await, None);
}

#[sqlx::test]
async fn story_only_day_included(pool: PgPool) {
    let me = setup(&pool).await;
    story_on(&pool, me, d("2026-05-10")).await;
    assert_eq!(
        picked(&pool, "2027-05-10", None).await,
        Some((MemoryKind::Years, 1, d("2026-05-10")))
    );
}

#[sqlx::test]
async fn milestone_only_day_included(pool: PgPool) {
    let me = setup(&pool).await;
    let a = baby(&pool, "a").await;
    milestone_on(&pool, a, me, d("2026-05-10")).await;
    assert_eq!(
        picked(&pool, "2027-05-10", None).await,
        Some((MemoryKind::Years, 1, d("2026-05-10")))
    );
}

#[sqlx::test]
async fn endpoint_returns_day(pool: PgPool) {
    let (server, user) = server_as(&pool, "mom", Role::Owner).await;
    settings::queries::set(&pool, "timezone", json!("UTC"))
        .await
        .unwrap();
    let res = server.get("/api/memories").await;
    res.assert_status_ok();
    assert_eq!(res.json::<Value>(), Value::Null);

    let today: NaiveDate =
        sqlx::query_scalar!(r#"SELECT (now() AT TIME ZONE 'UTC')::date AS "t!""#)
            .fetch_one(&pool)
            .await
            .unwrap();
    // 2/29 는 1년 전 같은 날이 없으므로 4년 전.
    let years = if today.month() == 2 && today.day() == 29 {
        4
    } else {
        1
    };
    let year_ago = today.with_year(today.year() - years).unwrap();
    photo_on(&pool, user.id, year_ago).await;
    let body: Value = server.get("/api/memories").await.json();
    assert_eq!(body["kind"], "years");
    assert_eq!(body["n"], years);
    assert_eq!(body["day"]["date"], year_ago.to_string());
    assert_eq!(body["day"]["preview"].as_array().unwrap().len(), 1);
}
