mod common;

use axum::http::StatusCode;
use axum_test::{TestResponse, TestServer};
use chrono::{DateTime, Utc};
use common::{AssetSeed, XRW, XRW_VALUE, assert_error, insert_asset, media_app};
use littledays::users::Role;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

/// 시간대 차이와 무관하게 같은 날짜가 되도록 정오(UTC) 촬영.
fn at(date: &str) -> DateTime<Utc> {
    format!("{date}T12:00:00Z").parse().unwrap()
}

async fn seed(
    pool: &PgPool,
    by: Uuid,
    kind: &'static str,
    status: &'static str,
    date: &str,
) -> Uuid {
    let mut s = AssetSeed::photo(by);
    s.kind = kind;
    s.status = status;
    s.taken_at = at(date);
    insert_asset(pool, s).await
}

async fn photo(pool: &PgPool, by: Uuid, date: &str) -> Uuid {
    seed(pool, by, "photo", "ready", date).await
}

async fn post_album(server: &TestServer, body: Value) -> TestResponse {
    server
        .post("/api/albums")
        .add_header(XRW, XRW_VALUE)
        .json(&body)
        .await
}

async fn create(server: &TestServer, body: Value) -> Value {
    let res = post_album(server, body).await;
    res.assert_status(StatusCode::CREATED);
    res.json()
}

async fn get(server: &TestServer, id: &str) -> Value {
    let res = server.get(&format!("/api/albums/{id}")).await;
    res.assert_status_ok();
    res.json()
}

async fn list(server: &TestServer) -> Vec<Value> {
    let res = server.get("/api/albums").await;
    res.assert_status_ok();
    res.json::<Vec<Value>>()
}

fn list_ids(albums: &[Value]) -> Vec<&str> {
    albums.iter().map(|a| a["id"].as_str().unwrap()).collect()
}

async fn patch(server: &TestServer, id: &str, body: Value) -> TestResponse {
    server
        .patch(&format!("/api/albums/{id}"))
        .add_header(XRW, XRW_VALUE)
        .json(&body)
        .await
}

async fn delete(server: &TestServer, id: &str) -> TestResponse {
    server
        .delete(&format!("/api/albums/{id}"))
        .add_header(XRW, XRW_VALUE)
        .await
}

async fn add(server: &TestServer, id: &str, assets: &[Uuid]) -> TestResponse {
    server
        .post(&format!("/api/albums/{id}/assets"))
        .add_header(XRW, XRW_VALUE)
        .json(&json!({ "asset_ids": assets }))
        .await
}

async fn remove(server: &TestServer, id: &str, assets: &[Uuid]) -> TestResponse {
    server
        .post(&format!("/api/albums/{id}/assets/remove"))
        .add_header(XRW, XRW_VALUE)
        .json(&json!({ "asset_ids": assets }))
        .await
}

async fn trash(server: &TestServer, asset: Uuid) {
    server
        .delete(&format!("/api/assets/{asset}"))
        .add_header(XRW, XRW_VALUE)
        .await
        .assert_status(StatusCode::NO_CONTENT);
}

async fn restore(server: &TestServer, asset: Uuid) {
    server
        .post(&format!("/api/assets/{asset}/restore"))
        .add_header(XRW, XRW_VALUE)
        .await
        .assert_status_ok();
}

fn cover_id(album: &Value) -> Option<String> {
    album["cover"]["id"].as_str().map(str::to_string)
}

async fn link_count(pool: &PgPool, asset: Uuid) -> i64 {
    sqlx::query_scalar!(
        r#"SELECT count(*) AS "n!" FROM album_assets WHERE asset_id = $1"#,
        asset
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

#[sqlx::test]
async fn create_list_get(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let created = create(&app.server, json!({ "name": "  봄 나들이 \n" })).await;
    assert_eq!(created["name"], "봄 나들이");
    assert_eq!(created["created_by"], app.user.id.to_string());
    assert_eq!(created["photo_count"], 0);
    assert_eq!(created["video_count"], 0);
    assert!(created["cover"].is_null());
    assert!(created["from"].is_null());
    assert!(created["to"].is_null());
    let id = created["id"].as_str().unwrap();

    assert_eq!(list(&app.server).await, vec![created.clone()]);
    assert_eq!(get(&app.server, id).await, created);

    // guardian 이 사진과 함께 만들기. 중복은 한 번만.
    let (guardian, _) = app.login_as("dad", Role::Guardian).await;
    let p1 = photo(&pool, app.user.id, "2024-03-10").await;
    let p2 = photo(&pool, app.user.id, "2024-04-01").await;
    let v = seed(&pool, app.user.id, "video", "ready", "2024-05-02").await;
    let with = create(
        &guardian,
        json!({ "name": "첫 바다", "asset_ids": [p2, v, p1, p2] }),
    )
    .await;
    assert_eq!(with["photo_count"], 2);
    assert_eq!(with["video_count"], 1);
    assert_eq!(with["from"], "2024-03-10");
    assert_eq!(with["to"], "2024-05-02");
    assert_eq!(cover_id(&with), Some(p1.to_string()));
    assert_eq!(with["cover"]["local_date"], "2024-03-10");
    let with_id = with["id"].as_str().unwrap();
    assert_eq!(get(&app.server, with_id).await, with);
    assert_eq!(list(&app.server).await.len(), 2);

    // 같은 사진이 표지인 앨범 여럿.
    let same = create(&app.server, json!({ "name": "또 바다", "asset_ids": [p1] })).await;
    let all = list(&app.server).await;
    assert_eq!(list_ids(&all), [same["id"].as_str().unwrap(), with_id, id]);
    assert_eq!(cover_id(&all[0]), Some(p1.to_string()));
    assert_eq!(cover_id(&all[1]), Some(p1.to_string()));
}

#[sqlx::test]
async fn family_read_only(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let p = photo(&pool, app.user.id, "2024-03-10").await;
    let album = create(&app.server, json!({ "name": "가족", "asset_ids": [p] })).await;
    let id = album["id"].as_str().unwrap();
    let (family, _) = app.login_as("grandma", Role::Family).await;

    assert_eq!(list(&family).await, vec![album.clone()]);
    assert_eq!(get(&family, id).await, album);

    let forbidden = "album.forbidden";
    assert_error(
        &post_album(&family, json!({ "name": "몰래" })).await,
        StatusCode::FORBIDDEN,
        forbidden,
    );
    assert_error(
        &patch(&family, id, json!({ "name": "바꿈" })).await,
        StatusCode::FORBIDDEN,
        forbidden,
    );
    assert_error(&delete(&family, id).await, StatusCode::FORBIDDEN, forbidden);
    assert_error(
        &add(&family, id, &[p]).await,
        StatusCode::FORBIDDEN,
        forbidden,
    );
    assert_error(
        &remove(&family, id, &[p]).await,
        StatusCode::FORBIDDEN,
        forbidden,
    );
    assert_eq!(get(&app.server, id).await, album);
}

#[sqlx::test]
async fn name_limits(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let long = "가".repeat(50);
    let album = create(&app.server, json!({ "name": format!(" {long} ") })).await;
    assert_eq!(album["name"], long);
    let id = album["id"].as_str().unwrap();

    for bad in ["가".repeat(51), "  \n ".to_string(), String::new()] {
        assert_error(
            &post_album(&app.server, json!({ "name": bad })).await,
            StatusCode::BAD_REQUEST,
            "album.nameInvalid",
        );
        assert_error(
            &patch(&app.server, id, json!({ "name": bad })).await,
            StatusCode::BAD_REQUEST,
            "album.nameInvalid",
        );
    }

    let res = patch(&app.server, id, json!({ "name": " 새 이름 " })).await;
    res.assert_status_ok();
    let renamed: Value = res.json();
    assert_eq!(renamed["name"], "새 이름");
    assert_ne!(renamed["updated_at"], album["updated_at"]);
    assert_eq!(list(&app.server).await, vec![renamed]);

    assert_error(
        &patch(
            &app.server,
            &Uuid::now_v7().to_string(),
            json!({ "name": "x" }),
        )
        .await,
        StatusCode::NOT_FOUND,
        "album.notFound",
    );
}

#[sqlx::test]
async fn add_idempotent_and_atomic(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let album = create(&app.server, json!({ "name": "모음" })).await;
    let id = album["id"].as_str().unwrap();
    let a = photo(&pool, app.user.id, "2024-03-10").await;
    let b = photo(&pool, app.user.id, "2024-03-11").await;
    let mut trashed = AssetSeed::photo(app.user.id);
    trashed.deleted_at = Some(Utc::now());
    let trashed = insert_asset(&pool, trashed).await;

    add(&app.server, id, &[a, a])
        .await
        .assert_status(StatusCode::NO_CONTENT);
    add(&app.server, id, &[a])
        .await
        .assert_status(StatusCode::NO_CONTENT);
    let after = get(&app.server, id).await;
    assert_eq!(after["photo_count"], 1);
    assert_ne!(after["updated_at"], album["updated_at"]);

    for bad in [trashed, Uuid::now_v7()] {
        assert_error(
            &add(&app.server, id, &[b, bad]).await,
            StatusCode::NOT_FOUND,
            "asset.notFound",
        );
    }
    assert_eq!(get(&app.server, id).await["photo_count"], 1);
    assert_eq!(link_count(&pool, b).await, 0);

    let many: Vec<Uuid> = (0..501).map(|_| Uuid::now_v7()).collect();
    for bad in [&many[..], &[][..]] {
        assert_error(
            &add(&app.server, id, bad).await,
            StatusCode::BAD_REQUEST,
            "request.invalidBody",
        );
    }
    assert_error(
        &post_album(&app.server, json!({ "name": "많이", "asset_ids": many })).await,
        StatusCode::BAD_REQUEST,
        "request.invalidBody",
    );
    assert_error(
        &post_album(
            &app.server,
            json!({ "name": "휴지통", "asset_ids": [trashed] }),
        )
        .await,
        StatusCode::NOT_FOUND,
        "asset.notFound",
    );
    assert_eq!(list(&app.server).await.len(), 1);

    assert_error(
        &add(&app.server, &Uuid::now_v7().to_string(), &[a]).await,
        StatusCode::NOT_FOUND,
        "album.notFound",
    );
}

#[sqlx::test]
async fn remove_idempotent_clears_cover(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let a = photo(&pool, app.user.id, "2024-03-10").await;
    let b = photo(&pool, app.user.id, "2024-03-11").await;
    let album = create(&app.server, json!({ "name": "모음", "asset_ids": [a, b] })).await;
    let id = album["id"].as_str().unwrap();
    patch(&app.server, id, json!({ "cover_asset_id": b }))
        .await
        .assert_status_ok();
    assert_eq!(cover_id(&get(&app.server, id).await), Some(b.to_string()));

    remove(&app.server, id, &[Uuid::now_v7()])
        .await
        .assert_status(StatusCode::NO_CONTENT);
    assert_eq!(get(&app.server, id).await["photo_count"], 2);

    let before = get(&app.server, id).await;
    remove(&app.server, id, &[b, b])
        .await
        .assert_status(StatusCode::NO_CONTENT);
    let after = get(&app.server, id).await;
    assert_eq!(after["photo_count"], 1);
    assert_eq!(cover_id(&after), Some(a.to_string()));
    assert_ne!(after["updated_at"], before["updated_at"]);
    let stored = sqlx::query_scalar!(
        "SELECT cover_asset_id FROM albums WHERE id = $1",
        id.parse::<Uuid>().unwrap()
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(stored, None);

    remove(&app.server, id, &[b])
        .await
        .assert_status(StatusCode::NO_CONTENT);
    assert_eq!(get(&app.server, id).await["photo_count"], 1);

    let many: Vec<Uuid> = (0..501).map(|_| Uuid::now_v7()).collect();
    for bad in [&many[..], &[][..]] {
        assert_error(
            &remove(&app.server, id, bad).await,
            StatusCode::BAD_REQUEST,
            "request.invalidBody",
        );
    }
    assert_error(
        &remove(&app.server, &Uuid::now_v7().to_string(), &[a]).await,
        StatusCode::NOT_FOUND,
        "album.notFound",
    );
}

#[sqlx::test]
async fn list_order(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let first = create(&app.server, json!({ "name": "처음" })).await;
    let second = create(&app.server, json!({ "name": "둘째" })).await;
    let third = create(&app.server, json!({ "name": "셋째" })).await;
    let (first, second, third) = (
        first["id"].as_str().unwrap(),
        second["id"].as_str().unwrap(),
        third["id"].as_str().unwrap(),
    );

    // 빈 앨범은 만든 시각 최신순.
    assert_eq!(list_ids(&list(&app.server).await), [third, second, first]);

    let p = photo(&pool, app.user.id, "2024-03-10").await;
    let q = photo(&pool, app.user.id, "2024-03-11").await;
    add(&app.server, first, &[p])
        .await
        .assert_status(StatusCode::NO_CONTENT);
    assert_eq!(list_ids(&list(&app.server).await), [first, third, second]);

    add(&app.server, second, &[q])
        .await
        .assert_status(StatusCode::NO_CONTENT);
    assert_eq!(list_ids(&list(&app.server).await), [second, first, third]);

    // 휴지통 사진의 넣은 시각은 제외.
    trash(&app.server, q).await;
    assert_eq!(list_ids(&list(&app.server).await), [first, third, second]);
}

#[sqlx::test]
async fn counts_dates_exclude_trash(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let p1 = photo(&pool, app.user.id, "2024-03-10").await;
    let p2 = photo(&pool, app.user.id, "2024-04-01").await;
    let v = seed(&pool, app.user.id, "video", "ready", "2024-05-02").await;
    let album = create(
        &app.server,
        json!({ "name": "봄", "asset_ids": [p1, p2, v] }),
    )
    .await;
    let id = album["id"].as_str().unwrap();
    assert_eq!(cover_id(&album), Some(p1.to_string()));

    trash(&app.server, p1).await;
    trash(&app.server, v).await;
    let hidden = get(&app.server, id).await;
    assert_eq!(hidden["photo_count"], 1);
    assert_eq!(hidden["video_count"], 0);
    assert_eq!(hidden["from"], "2024-04-01");
    assert_eq!(hidden["to"], "2024-04-01");
    assert_eq!(cover_id(&hidden), Some(p2.to_string()));

    restore(&app.server, p1).await;
    restore(&app.server, v).await;
    let back = get(&app.server, id).await;
    assert_eq!(back["photo_count"], 2);
    assert_eq!(back["video_count"], 1);
    assert_eq!(back["from"], "2024-03-10");
    assert_eq!(back["to"], "2024-05-02");
    assert_eq!(cover_id(&back), Some(p1.to_string()));

    // 지정 표지도 휴지통 동안만 빠짐.
    patch(&app.server, id, json!({ "cover_asset_id": p2 }))
        .await
        .assert_status_ok();
    trash(&app.server, p2).await;
    assert_eq!(cover_id(&get(&app.server, id).await), Some(p1.to_string()));
    restore(&app.server, p2).await;
    assert_eq!(cover_id(&get(&app.server, id).await), Some(p2.to_string()));
}

#[sqlx::test]
async fn cover_rules(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let newer = photo(&pool, app.user.id, "2024-04-01").await;
    let older = photo(&pool, app.user.id, "2024-03-10").await;
    let processing = seed(&pool, app.user.id, "photo", "processing", "2024-03-01").await;
    let gone = photo(&pool, app.user.id, "2024-03-05").await;
    let outside = photo(&pool, app.user.id, "2024-03-07").await;
    let album = create(
        &app.server,
        json!({ "name": "표지", "asset_ids": [newer, older, processing, gone] }),
    )
    .await;
    let id = album["id"].as_str().unwrap();
    trash(&app.server, gone).await;
    assert_eq!(
        cover_id(&get(&app.server, id).await),
        Some(older.to_string())
    );

    for bad in [outside, gone, processing, Uuid::now_v7()] {
        assert_error(
            &patch(&app.server, id, json!({ "cover_asset_id": bad })).await,
            StatusCode::BAD_REQUEST,
            "album.coverInvalid",
        );
    }

    let res = patch(&app.server, id, json!({ "cover_asset_id": newer })).await;
    res.assert_status_ok();
    assert_eq!(cover_id(&res.json()), Some(newer.to_string()));

    // 키 없으면 표지 유지.
    let renamed: Value = patch(&app.server, id, json!({ "name": "표지 유지" }))
        .await
        .json();
    assert_eq!(cover_id(&renamed), Some(newer.to_string()));

    let reset: Value = patch(&app.server, id, json!({ "cover_asset_id": null }))
        .await
        .json();
    assert_eq!(cover_id(&reset), Some(older.to_string()));
    assert_eq!(reset["name"], "표지 유지");
}

#[sqlx::test]
async fn cover_skips_unready(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let processing = seed(&pool, app.user.id, "photo", "processing", "2024-03-10").await;
    let failed = seed(&pool, app.user.id, "video", "failed", "2024-03-01").await;
    let album = create(
        &app.server,
        json!({ "name": "처리 중", "asset_ids": [processing, failed] }),
    )
    .await;
    assert!(album["cover"].is_null());
    assert_eq!(album["photo_count"], 1);
    assert_eq!(album["video_count"], 1);
    assert_eq!(album["from"], "2024-03-01");
    assert_eq!(album["to"], "2024-03-10");
}

#[sqlx::test]
async fn permanent_delete_cascades(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let a = photo(&pool, app.user.id, "2024-03-10").await;
    let b = photo(&pool, app.user.id, "2024-03-11").await;
    let album = create(&app.server, json!({ "name": "삭제", "asset_ids": [a, b] })).await;
    let id = album["id"].as_str().unwrap();
    patch(&app.server, id, json!({ "cover_asset_id": b }))
        .await
        .assert_status_ok();

    trash(&app.server, b).await;
    app.server
        .delete(&format!("/api/assets/{b}/permanent"))
        .add_header(XRW, XRW_VALUE)
        .await
        .assert_status(StatusCode::NO_CONTENT);

    assert_eq!(link_count(&pool, b).await, 0);
    let stored = sqlx::query_scalar!(
        "SELECT cover_asset_id FROM albums WHERE id = $1",
        id.parse::<Uuid>().unwrap()
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(stored, None);
    let after = get(&app.server, id).await;
    assert_eq!(after["photo_count"], 1);
    assert_eq!(cover_id(&after), Some(a.to_string()));
}

#[sqlx::test]
async fn delete_keeps_assets(pool: PgPool) {
    let app = media_app(&pool, Role::Owner).await;
    let a = photo(&pool, app.user.id, "2024-03-10").await;
    let album = create(
        &app.server,
        json!({ "name": "지울 앨범", "asset_ids": [a] }),
    )
    .await;
    let id = album["id"].as_str().unwrap();
    // 남이 만든 앨범도 guardian 이 지움.
    let (guardian, _) = app.login_as("dad", Role::Guardian).await;

    delete(&guardian, id)
        .await
        .assert_status(StatusCode::NO_CONTENT);
    app.server
        .get(&format!("/api/assets/{a}"))
        .await
        .assert_status_ok();
    assert_eq!(link_count(&pool, a).await, 0);
    assert!(list(&app.server).await.is_empty());
    assert_error(
        &app.server.get(&format!("/api/albums/{id}")).await,
        StatusCode::NOT_FOUND,
        "album.notFound",
    );
    assert_error(
        &delete(&app.server, id).await,
        StatusCode::NOT_FOUND,
        "album.notFound",
    );
}
