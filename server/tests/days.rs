mod common;

use axum::http::StatusCode;
use chrono::{DateTime, Duration, NaiveDate, TimeZone, Utc};
use common::{AssetSeed, assert_error, insert_asset, media_app, test_server};
use littledays::{
    assets,
    babies::{self, BabyInput},
    settings,
    users::Role,
};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

async fn baby(pool: &PgPool, name: &str) -> Uuid {
    babies::queries::create(
        pool,
        BabyInput {
            name: name.to_string(),
            birth_date: "2024-01-01".parse().unwrap(),
            sex: None,
        },
    )
    .await
    .expect("baby")
    .id
}

async fn set_timezone(pool: &PgPool, tz: &str) {
    settings::queries::set(pool, "timezone", json!(tz))
        .await
        .unwrap();
}

async fn photo(pool: &PgPool, by: Uuid, taken_at: DateTime<Utc>) -> Uuid {
    let mut s = AssetSeed::photo(by);
    s.taken_at = taken_at;
    insert_asset(pool, s).await
}

async fn video(pool: &PgPool, by: Uuid, taken_at: DateTime<Utc>) -> Uuid {
    let mut s = AssetSeed::photo(by);
    s.kind = "video";
    s.mime = "video/mp4".to_string();
    s.taken_at = taken_at;
    insert_asset(pool, s).await
}

/// UTC 기준 2024-05-`day` `hour`시.
fn at(day: u32, hour: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2024, 5, day, hour, 0, 0).unwrap()
}

fn dates(page: &Value) -> Vec<String> {
    page["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| d["date"].as_str().unwrap().to_string())
        .collect()
}

fn uuids(v: &Value) -> Vec<Uuid> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|i| i.as_str().unwrap().parse().unwrap())
        .collect()
}

fn preview_ids(day: &Value) -> Vec<Uuid> {
    day["preview"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["id"].as_str().unwrap().parse().unwrap())
        .collect()
}

#[sqlx::test]
async fn days_group_by_local_date(pool: PgPool) {
    let app = media_app(&pool, Role::Family).await;
    set_timezone(&pool, "UTC").await;
    let me = app.user.id;
    // 05-03: 사진 4 + 영상 1, 05-02: 사진 2, 05-01: 영상 1
    let mut d3 = Vec::new();
    for h in [1, 2, 3, 4] {
        d3.push(photo(&pool, me, at(3, h)).await);
    }
    d3.push(video(&pool, me, at(3, 5)).await);
    let d2a = photo(&pool, me, at(2, 8)).await;
    let d2b = photo(&pool, me, at(2, 9)).await;
    video(&pool, me, at(1, 8)).await;

    let res = app.server.get("/api/days").await;
    res.assert_status_ok();
    let page: Value = res.json();
    assert_eq!(dates(&page), ["2024-05-03", "2024-05-02", "2024-05-01"]);
    assert!(page["next_cursor"].is_null());

    let items = page["items"].as_array().unwrap();
    let counts: Vec<(i64, i64)> = items
        .iter()
        .map(|d| {
            (
                d["photo_count"].as_i64().unwrap(),
                d["video_count"].as_i64().unwrap(),
            )
        })
        .collect();
    assert_eq!(counts, [(4, 1), (2, 0), (0, 1)]);
    // 최신 3장, taken_at 내림차순
    assert_eq!(preview_ids(&items[0]), [d3[4], d3[3], d3[2]]);
    assert_eq!(preview_ids(&items[1]), [d2b, d2a]);
    assert_eq!(items[0]["preview"][0]["kind"], "video");
    assert_eq!(items[0]["preview"][0]["local_date"], "2024-05-03");
    assert_eq!(uuids(&items[0]["uploader_ids"]), [me]);
    assert_eq!(items[0]["baby_ids"], json!([]));
}

#[sqlx::test]
async fn days_cursor_pages(pool: PgPool) {
    let app = media_app(&pool, Role::Family).await;
    set_timezone(&pool, "UTC").await;
    for d in 1..=5 {
        photo(&pool, app.user.id, at(d, 12)).await;
        photo(&pool, app.user.id, at(d, 13)).await;
    }

    let mut got = Vec::new();
    let mut cursors = Vec::new();
    let mut cursor: Option<String> = None;
    loop {
        let mut req = app.server.get("/api/days").add_query_param("limit", 2);
        if let Some(c) = &cursor {
            req = req.add_query_param("cursor", c);
        }
        let page: Value = req.await.json();
        got.extend(dates(&page));
        match page["next_cursor"].as_str() {
            Some(c) => {
                cursors.push(c.to_string());
                cursor = Some(c.to_string());
            }
            None => break,
        }
    }
    assert_eq!(
        got,
        [
            "2024-05-05",
            "2024-05-04",
            "2024-05-03",
            "2024-05-02",
            "2024-05-01"
        ]
    );
    assert_eq!(cursors, ["2024-05-04", "2024-05-02"]);
}

#[sqlx::test]
async fn days_baby_filter(pool: PgPool) {
    let app = media_app(&pool, Role::Family).await;
    set_timezone(&pool, "UTC").await;
    let (_, dad) = app.login_as("dad", Role::Guardian).await;
    let a = baby(&pool, "a").await;
    let b = baby(&pool, "b").await;
    let both = photo(&pool, app.user.id, at(2, 10)).await;
    photo(&pool, dad.id, at(2, 11)).await;
    photo(&pool, app.user.id, at(2, 12)).await;
    let only_b = photo(&pool, dad.id, at(1, 10)).await;
    // 태그 순서와 무관하게 아기 표시 순서
    assets::queries::add_babies(&pool, both, &[b, a], app.user.id)
        .await
        .unwrap();
    assets::queries::add_babies(&pool, only_b, &[b], app.user.id)
        .await
        .unwrap();

    let all: Value = app.server.get("/api/days").await.json();
    assert_eq!(dates(&all), ["2024-05-02", "2024-05-01"]);
    assert_eq!(uuids(&all["items"][0]["baby_ids"]), [a, b]);
    let mut uploaders = uuids(&all["items"][0]["uploader_ids"]);
    uploaders.sort();
    let mut expected = vec![app.user.id, dad.id];
    expected.sort();
    assert_eq!(uploaders, expected);
    assert_eq!(all["items"][0]["photo_count"], 3);

    let filtered: Value = app
        .server
        .get("/api/days")
        .add_query_param("baby_id", a)
        .await
        .json();
    assert_eq!(dates(&filtered), ["2024-05-02"]);
    let day = &filtered["items"][0];
    assert_eq!(day["photo_count"], 1);
    assert_eq!(preview_ids(day), [both]);
    assert_eq!(uuids(&day["uploader_ids"]), [app.user.id]);

    let detail = app
        .server
        .get("/api/days/2024-05-01")
        .add_query_param("baby_id", a)
        .await;
    assert_error(&detail, StatusCode::NOT_FOUND, "day.notFound");
    let detail: Value = app
        .server
        .get("/api/days/2024-05-01")
        .add_query_param("baby_id", b)
        .await
        .json();
    assert_eq!(detail["photo_count"], 1);
    assert_eq!(uuids(&detail["baby_ids"]), [b]);
    assert_eq!(detail["next_date"], "2024-05-02");
}

#[sqlx::test]
async fn days_from_to_inclusive(pool: PgPool) {
    let app = media_app(&pool, Role::Family).await;
    set_timezone(&pool, "UTC").await;
    for d in 1..=5 {
        photo(&pool, app.user.id, at(d, 12)).await;
    }
    let page: Value = app
        .server
        .get("/api/days")
        .add_query_param("from", "2024-05-02")
        .add_query_param("to", "2024-05-04")
        .await
        .json();
    assert_eq!(dates(&page), ["2024-05-04", "2024-05-03", "2024-05-02"]);

    let page: Value = app
        .server
        .get("/api/days")
        .add_query_param("from", "2024-05-02")
        .add_query_param("to", "2024-05-04")
        .add_query_param("cursor", "2024-05-04")
        .add_query_param("limit", 1)
        .await
        .json();
    assert_eq!(dates(&page), ["2024-05-03"]);
    assert_eq!(page["next_cursor"], "2024-05-03");
}

#[sqlx::test]
async fn days_follow_instance_timezone(pool: PgPool) {
    let app = media_app(&pool, Role::Family).await;
    set_timezone(&pool, "Asia/Seoul").await;
    // 현지 05-01 23:30, 05-02 00:30
    let late = Utc.with_ymd_and_hms(2024, 5, 1, 14, 30, 0).unwrap();
    photo(&pool, app.user.id, late).await;
    photo(&pool, app.user.id, late + Duration::hours(1)).await;

    let page: Value = app.server.get("/api/days").await.json();
    assert_eq!(dates(&page), ["2024-05-02", "2024-05-01"]);
    let detail: Value = app.server.get("/api/days/2024-05-01").await.json();
    assert_eq!(detail["photo_count"], 1);
    assert_eq!(detail["next_date"], "2024-05-02");

    set_timezone(&pool, "UTC").await;
    let page: Value = app.server.get("/api/days").await.json();
    assert_eq!(dates(&page), ["2024-05-01"]);
}

#[sqlx::test]
async fn trashed_day_is_gone(pool: PgPool) {
    let app = media_app(&pool, Role::Family).await;
    set_timezone(&pool, "UTC").await;
    photo(&pool, app.user.id, at(1, 12)).await;
    for h in [10, 11] {
        let mut s = AssetSeed::photo(app.user.id);
        s.taken_at = at(2, h);
        s.deleted_at = Some(Utc::now());
        insert_asset(&pool, s).await;
    }

    let page: Value = app.server.get("/api/days").await.json();
    assert_eq!(dates(&page), ["2024-05-01"]);
    let res = app.server.get("/api/days/2024-05-02").await;
    assert_error(&res, StatusCode::NOT_FOUND, "day.notFound");
    let detail: Value = app.server.get("/api/days/2024-05-01").await.json();
    assert!(detail["next_date"].is_null());
}

#[sqlx::test]
async fn day_detail_prev_next(pool: PgPool) {
    let app = media_app(&pool, Role::Family).await;
    set_timezone(&pool, "UTC").await;
    let (_, dad) = app.login_as("dad", Role::Guardian).await;
    let a = baby(&pool, "a").await;
    // 사이에 빈 날짜(05-02, 05-04)
    photo(&pool, app.user.id, at(1, 12)).await;
    let mid = photo(&pool, app.user.id, at(3, 9)).await;
    photo(&pool, dad.id, at(3, 10)).await;
    photo(&pool, dad.id, at(3, 11)).await;
    video(&pool, app.user.id, at(3, 12)).await;
    photo(&pool, app.user.id, at(5, 12)).await;
    assets::queries::add_babies(&pool, mid, &[a], app.user.id)
        .await
        .unwrap();

    let res = app.server.get("/api/days/2024-05-03").await;
    res.assert_status_ok();
    let detail: Value = res.json();
    assert_eq!(detail["date"], "2024-05-03");
    assert_eq!(detail["photo_count"], 3);
    assert_eq!(detail["video_count"], 1);
    assert_eq!(detail["prev_date"], "2024-05-01");
    assert_eq!(detail["next_date"], "2024-05-05");
    assert_eq!(uuids(&detail["baby_ids"]), [a]);
    let mut uploaders = uuids(&detail["uploader_ids"]);
    uploaders.sort();
    let mut expected = vec![app.user.id, dad.id];
    expected.sort();
    assert_eq!(uploaders, expected);

    let oldest: Value = app.server.get("/api/days/2024-05-01").await.json();
    assert!(oldest["prev_date"].is_null());
    assert_eq!(oldest["next_date"], "2024-05-03");
    let newest: Value = app.server.get("/api/days/2024-05-05").await.json();
    assert_eq!(newest["prev_date"], "2024-05-03");
    assert!(newest["next_date"].is_null());

    let empty = app.server.get("/api/days/2024-05-02").await;
    assert_error(&empty, StatusCode::NOT_FOUND, "day.notFound");
}

async fn like(pool: &PgPool, asset: Uuid, user: Uuid) {
    sqlx::query!(
        "INSERT INTO asset_likes (asset_id, user_id) VALUES ($1, $2)",
        asset,
        user
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn comment(pool: &PgPool, asset: Uuid, author: Uuid) {
    sqlx::query!(
        "INSERT INTO asset_comments (id, asset_id, author_id, body) VALUES ($1, $2, $3, 'hi')",
        Uuid::now_v7(),
        asset,
        author
    )
    .execute(pool)
    .await
    .unwrap();
}

fn reaction_counts(day: &Value) -> (i64, i64) {
    (
        day["like_count"].as_i64().unwrap(),
        day["comment_count"].as_i64().unwrap(),
    )
}

#[sqlx::test]
async fn day_counts_reactions(pool: PgPool) {
    let app = media_app(&pool, Role::Family).await;
    set_timezone(&pool, "UTC").await;
    let (_, dad) = app.login_as("dad", Role::Guardian).await;
    let a = baby(&pool, "a").await;
    let me = app.user.id;
    // 05-02: 아기 a 사진(하트 2, 댓글 1), 태그 없는 사진(하트 1), 휴지통 사진(하트 1, 댓글 1)
    let tagged = photo(&pool, me, at(2, 10)).await;
    let untagged = photo(&pool, me, at(2, 11)).await;
    let mut s = AssetSeed::photo(me);
    s.taken_at = at(2, 12);
    s.deleted_at = Some(Utc::now());
    let trashed = insert_asset(&pool, s).await;
    // 05-01: 반응 없음
    photo(&pool, me, at(1, 10)).await;
    assets::queries::add_babies(&pool, tagged, &[a], me)
        .await
        .unwrap();
    like(&pool, tagged, me).await;
    like(&pool, tagged, dad.id).await;
    comment(&pool, tagged, dad.id).await;
    like(&pool, untagged, me).await;
    like(&pool, trashed, me).await;
    comment(&pool, trashed, me).await;

    let all: Value = app.server.get("/api/days").await.json();
    assert_eq!(dates(&all), ["2024-05-02", "2024-05-01"]);
    assert_eq!(reaction_counts(&all["items"][0]), (3, 1));
    assert_eq!(reaction_counts(&all["items"][1]), (0, 0));
    let detail: Value = app.server.get("/api/days/2024-05-02").await.json();
    assert_eq!(reaction_counts(&detail), (3, 1));
    let detail: Value = app.server.get("/api/days/2024-05-01").await.json();
    assert_eq!(reaction_counts(&detail), (0, 0));

    let filtered: Value = app
        .server
        .get("/api/days")
        .add_query_param("baby_id", a)
        .await
        .json();
    assert_eq!(reaction_counts(&filtered["items"][0]), (2, 1));
    let detail: Value = app
        .server
        .get("/api/days/2024-05-02")
        .add_query_param("baby_id", a)
        .await
        .json();
    assert_eq!(reaction_counts(&detail), (2, 1));
}

#[sqlx::test]
async fn days_invalid_query(pool: PgPool) {
    let app = media_app(&pool, Role::Family).await;
    for (key, value) in [
        ("limit", "0"),
        ("limit", "101"),
        ("limit", "abc"),
        ("cursor", "2024-13-01"),
        ("from", "yesterday"),
    ] {
        let res = app
            .server
            .get("/api/days")
            .add_query_param(key, value)
            .await;
        assert_error(&res, StatusCode::BAD_REQUEST, "request.invalidQuery");
    }
    let res = app.server.get("/api/days/2024-02-30").await;
    assert_error(&res, StatusCode::BAD_REQUEST, "request.invalidPath");
}

#[sqlx::test]
async fn days_require_auth(pool: PgPool) {
    let server = test_server(pool).await;
    let res = server.get("/api/days").await;
    assert_error(&res, StatusCode::UNAUTHORIZED, "auth.required");
    let res = server.get("/api/days/2024-05-01").await;
    assert_error(&res, StatusCode::UNAUTHORIZED, "auth.required");
}

/// 성능 확인용. `cargo test --test days -- --ignored --nocapture days_perf_10k`
#[sqlx::test]
#[ignore]
async fn days_perf_10k(pool: PgPool) {
    let app = media_app(&pool, Role::Family).await;
    let (_, dad) = app.login_as("dad", Role::Guardian).await;
    let a = baby(&pool, "a").await;
    let b = baby(&pool, "b").await;
    // 1,000일 × 10장. 아기 태그는 절반, 업로더 둘
    sqlx::query(
        "INSERT INTO assets (id, kind, uploaded_by, original_path, original_filename, mime,
                             size_bytes, sha256, taken_at, taken_at_source, status)
         SELECT gen_random_uuid(),
                CASE WHEN g % 10 = 0 THEN 'video'::asset_kind ELSE 'photo'::asset_kind END,
                CASE WHEN g % 3 = 0 THEN $2 ELSE $1 END,
                'originals/x/' || g, g || '.jpg', 'image/jpeg', 1,
                sha256(g::text::bytea),
                timestamptz '2024-01-01 00:00:00+00'
                  + make_interval(days => g / 10, hours => g % 10 * 2),
                'upload_time', 'ready'
         FROM generate_series(0, 9999) AS g",
    )
    .bind(app.user.id)
    .bind(dad.id)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO asset_babies (asset_id, baby_id, tagged_by)
         SELECT id, CASE WHEN row_number() OVER (ORDER BY id) % 2 = 0 THEN $1 ELSE $2 END, $3
         FROM assets",
    )
    .bind(a)
    .bind(b)
    .bind(app.user.id)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("ANALYZE").execute(&pool).await.unwrap();

    let mut times = Vec::new();
    for _ in 0..5 {
        let started = std::time::Instant::now();
        let page: Value = app.server.get("/api/days").await.json();
        times.push(started.elapsed());
        assert_eq!(page["items"].as_array().unwrap().len(), 20);
    }
    println!("GET /api/days first page (wall): {times:?}");
    let mut times = Vec::new();
    for _ in 0..5 {
        let started = std::time::Instant::now();
        app.server
            .get("/api/days/2025-05-01")
            .await
            .assert_status_ok();
        times.push(started.elapsed());
    }
    println!("GET /api/days/2025-05-01 (wall): {times:?}");

    // days/queries.rs 와 같은 SQL. 첫 페이지 매개변수.
    let tz = settings::queries::load(&pool).await.unwrap().timezone;
    let first: Vec<NaiveDate> = sqlx::query_scalar(
        "SELECT DISTINCT (taken_at AT TIME ZONE $1)::date FROM assets ORDER BY 1 DESC LIMIT 20",
    )
    .bind(&tz)
    .fetch_all(&pool)
    .await
    .unwrap();
    let mid = NaiveDate::from_ymd_opt(2025, 5, 1).unwrap();
    let plans = [
        ("list", PERF_LIST_SQL, None),
        ("previews", PERF_PREVIEWS_SQL, None),
        ("detail", PERF_DETAIL_SQL, Some(mid)),
    ];
    for (name, sql, date) in plans {
        println!("---- {name}");
        let explain = format!("EXPLAIN (ANALYZE, BUFFERS) {sql}");
        let mut q = sqlx::query_scalar::<_, String>(&explain).bind(&tz);
        q = match (name, date) {
            ("previews", _) => q.bind(&first).bind(None::<Uuid>),
            (_, Some(d)) => q.bind(d).bind(None::<Uuid>),
            _ => q
                .bind(None::<Uuid>)
                .bind(None::<NaiveDate>)
                .bind(None::<NaiveDate>)
                .bind(None::<NaiveDate>)
                .bind(21_i64),
        };
        for line in q.fetch_all(&pool).await.unwrap() {
            println!("{line}");
        }
    }
}

const PERF_LIST_SQL: &str = r#"WITH days AS (
    SELECT (a.taken_at AT TIME ZONE $1)::date AS date,
           count(*) FILTER (WHERE a.kind = 'photo') AS photo_count,
           count(*) FILTER (WHERE a.kind = 'video') AS video_count,
           array_agg(DISTINCT a.uploaded_by) AS uploader_ids,
           array_agg(a.id) AS asset_ids
    FROM assets a
    WHERE a.deleted_at IS NULL
      AND ($2::uuid IS NULL OR EXISTS (
            SELECT 1 FROM asset_babies ab WHERE ab.asset_id = a.id AND ab.baby_id = $2))
      AND ($3::date IS NULL OR (a.taken_at AT TIME ZONE $1)::date < $3)
      AND ($4::date IS NULL OR (a.taken_at AT TIME ZONE $1)::date >= $4)
      AND ($5::date IS NULL OR (a.taken_at AT TIME ZONE $1)::date <= $5)
    GROUP BY 1
    ORDER BY 1 DESC
    LIMIT $6
)
SELECT d.date, d.photo_count, d.video_count, d.uploader_ids,
       ARRAY(SELECT b.id FROM babies b
             WHERE EXISTS (SELECT 1 FROM asset_babies ab
                           WHERE ab.baby_id = b.id AND ab.asset_id = ANY(d.asset_ids))
             ORDER BY b.sort_order, b.created_at, b.id) AS baby_ids
FROM days d
ORDER BY d.date DESC"#;

const PERF_PREVIEWS_SQL: &str = r#"SELECT p.id, p.kind, p.status, p.taken_at, p.local_date,
       p.width, p.height, p.duration_ms, p.blurhash, p.dominant_color, p.uploaded_by,
       COALESCE((SELECT array_agg(b.id ORDER BY b.sort_order, b.created_at, b.id)
                 FROM asset_babies ab JOIN babies b ON b.id = ab.baby_id
                 WHERE ab.asset_id = p.id), '{}') AS baby_ids,
       p.derivatives
FROM (
    SELECT a.id, a.kind, a.status, a.taken_at, a.width, a.height, a.duration_ms,
           a.blurhash, a.dominant_color, a.uploaded_by, a.derivatives,
           (a.taken_at AT TIME ZONE $1)::date AS local_date,
           row_number() OVER (PARTITION BY (a.taken_at AT TIME ZONE $1)::date
                              ORDER BY a.taken_at DESC, a.id DESC) AS rn
    FROM assets a
    WHERE a.deleted_at IS NULL
      AND (a.taken_at AT TIME ZONE $1)::date = ANY($2::date[])
      AND ($3::uuid IS NULL OR EXISTS (
            SELECT 1 FROM asset_babies ab WHERE ab.asset_id = a.id AND ab.baby_id = $3))
) p
WHERE p.rn <= 3
ORDER BY p.local_date DESC, p.taken_at DESC, p.id DESC"#;

const PERF_DETAIL_SQL: &str = r#"SELECT d.photo_count, d.video_count,
       COALESCE(d.uploader_ids, '{}') AS uploader_ids,
       ARRAY(SELECT b.id FROM babies b
             WHERE EXISTS (SELECT 1 FROM asset_babies ab
                           WHERE ab.baby_id = b.id AND ab.asset_id = ANY(d.asset_ids))
             ORDER BY b.sort_order, b.created_at, b.id) AS baby_ids,
       d.prev_date, d.next_date
FROM (
    SELECT count(*) FILTER (WHERE f.date = $2 AND f.kind = 'photo') AS photo_count,
           count(*) FILTER (WHERE f.date = $2 AND f.kind = 'video') AS video_count,
           array_agg(DISTINCT f.uploaded_by) FILTER (WHERE f.date = $2) AS uploader_ids,
           array_agg(f.id) FILTER (WHERE f.date = $2) AS asset_ids,
           max(f.date) FILTER (WHERE f.date < $2) AS prev_date,
           min(f.date) FILTER (WHERE f.date > $2) AS next_date
    FROM (
        SELECT a.id, a.kind, a.uploaded_by, (a.taken_at AT TIME ZONE $1)::date AS date
        FROM assets a
        WHERE a.deleted_at IS NULL
          AND ($3::uuid IS NULL OR EXISTS (
                SELECT 1 FROM asset_babies ab
                WHERE ab.asset_id = a.id AND ab.baby_id = $3))
    ) f
) d"#;
