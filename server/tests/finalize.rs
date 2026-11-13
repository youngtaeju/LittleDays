mod common;

use std::{collections::HashSet, time::Duration};

use axum::http::StatusCode;
use axum_test::{TestResponse, TestServer};
use chrono::{DateTime, Utc};
use common::{
    MediaApp, XRW, XRW_VALUE, assert_error, media_app, tus_create, tus_patch, upload_bytes,
};
use littledays::{media::storage, users::Role};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

/// `FF D8 FF` 로 시작하는 가짜 JPEG. 디코드 불가, 형식 판별만 통과.
fn fake_jpeg() -> Vec<u8> {
    let mut bytes = vec![0xFF, 0xD8, 0xFF, 0xE0];
    bytes.extend(rand::random::<[u8; 60]>());
    bytes
}

async fn finalize_as(server: &TestServer, id: Uuid, body: Value) -> TestResponse {
    server
        .post(&format!("/api/uploads/{id}/finalize"))
        .add_header(XRW, XRW_VALUE)
        .json(&body)
        .await
}

async fn finalize(app: &MediaApp, id: Uuid, body: Value) -> TestResponse {
    finalize_as(&app.server, id, body).await
}

/// 201 확인 후 asset id.
async fn finalize_ok(app: &MediaApp, id: Uuid) -> Uuid {
    let res = finalize(app, id, json!({})).await;
    res.assert_status(StatusCode::CREATED);
    asset_id(&res.json())
}

fn asset_id(asset: &Value) -> Uuid {
    asset["id"].as_str().unwrap().parse().unwrap()
}

fn original_path(app: &MediaApp, asset: &Value) -> std::path::PathBuf {
    let created_at: DateTime<Utc> = asset["created_at"].as_str().unwrap().parse().unwrap();
    app.data.path().join(storage::original_rel_path(
        created_at,
        asset_id(asset),
        "jpg",
    ))
}

fn temp_exists(app: &MediaApp, upload_id: Uuid) -> bool {
    storage::upload_temp_path(app.data.path(), upload_id).exists()
}

async fn upload_exists(pool: &PgPool, upload_id: Uuid) -> bool {
    sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM uploads WHERE id = $1) AS "e!""#,
        upload_id
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn asset_count(pool: &PgPool) -> i64 {
    sqlx::query_scalar!(r#"SELECT count(*) AS "n!" FROM assets"#)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn set_status(pool: &PgPool, id: Uuid, status: &str) {
    sqlx::query!(
        "UPDATE assets SET status = $2::text::asset_status WHERE id = $1",
        id,
        status
    )
    .execute(pool)
    .await
    .unwrap();
}

fn assert_duplicate(res: &TestResponse, existing: Uuid, in_trash: bool) {
    res.assert_status(StatusCode::CONFLICT);
    res.assert_json(&json!({
        "error": "asset.duplicate",
        "params": { "asset_id": existing, "in_trash": in_trash },
    }));
}

#[sqlx::test(migrations = "./migrations")]
async fn finalize_creates_processing_asset(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let bytes = fake_jpeg();
    let upload = upload_bytes(&app, &bytes, "아기 사진.jpg").await;

    let res = finalize(&app, upload, json!({})).await;
    res.assert_status(StatusCode::CREATED);
    let asset: Value = res.json();
    assert_eq!(asset["status"], "processing");
    assert_eq!(asset["kind"], "photo");
    assert_eq!(asset["mime"], "image/jpeg");
    assert_eq!(asset["taken_at_source"], "upload_time");
    assert_eq!(asset["taken_at"], asset["created_at"]);
    assert_eq!(asset["original_filename"], "아기 사진.jpg");
    assert_eq!(asset["size_bytes"], bytes.len());
    assert_eq!(asset["uploaded_by"], json!(app.user.id));
    assert_eq!(asset["baby_ids"], json!([]));
    assert_eq!(asset["derivatives"], json!({}));
    assert_eq!(asset["deleted_at"], Value::Null);

    let id = asset_id(&asset);
    let path = original_path(&app, &asset);
    assert_eq!(std::fs::read(&path).unwrap(), bytes);
    let stored = sqlx::query_scalar!("SELECT original_path FROM assets WHERE id = $1", id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(app.data.path().join(stored), path);

    let jobs = sqlx::query!("SELECT kind, payload, status::text AS \"status!\" FROM jobs")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(jobs.len(), 1);
    assert_eq!(jobs[0].kind, "process_asset");
    assert_eq!(jobs[0].payload, json!({ "asset_id": id }));
    assert_eq!(jobs[0].status, "queued");
    tokio::time::timeout(Duration::from_secs(1), app.state.jobs_wake.notified())
        .await
        .expect("워커 깨움");

    assert!(!upload_exists(&pool, upload).await);
    assert!(!temp_exists(&app, upload));
}

#[sqlx::test(migrations = "./migrations")]
async fn finalize_refreshes_original_mtime(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let upload = upload_bytes(&app, &fake_jpeg(), "a.jpg").await;
    let old = std::time::SystemTime::now() - Duration::from_secs(48 * 3600);
    std::fs::File::open(storage::upload_temp_path(app.data.path(), upload))
        .unwrap()
        .set_modified(old)
        .unwrap();

    let asset: Value = finalize(&app, upload, json!({})).await.json();

    let modified = std::fs::metadata(original_path(&app, &asset))
        .unwrap()
        .modified()
        .unwrap();
    let age = std::time::SystemTime::now()
        .duration_since(modified)
        .unwrap_or_default();
    assert!(age < Duration::from_secs(60), "{age:?}");
}

#[sqlx::test(migrations = "./migrations")]
async fn file_modified_at_sets_source(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let upload = upload_bytes(&app, &fake_jpeg(), "a.jpg").await;

    let res = finalize(
        &app,
        upload,
        json!({ "file_modified_at": "2025-06-01T12:34:56Z" }),
    )
    .await;
    res.assert_status(StatusCode::CREATED);
    let asset: Value = res.json();
    let want: DateTime<Utc> = "2025-06-01T12:34:56Z".parse().unwrap();
    for field in ["taken_at", "file_modified_at"] {
        let got: DateTime<Utc> = asset[field].as_str().unwrap().parse().unwrap();
        assert_eq!(got, want, "{field}");
    }
    assert_eq!(asset["taken_at_source"], "file_mtime");
}

#[sqlx::test(migrations = "./migrations")]
async fn duplicate_of_ready_is_409(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let bytes = fake_jpeg();
    let first = upload_bytes(&app, &bytes, "a.jpg").await;
    let res = finalize(&app, first, json!({})).await;
    res.assert_status(StatusCode::CREATED);
    let asset: Value = res.json();
    let first_id = asset_id(&asset);
    set_status(&pool, first_id, "ready").await;

    let second = upload_bytes(&app, &bytes, "b.jpg").await;
    let res = finalize(&app, second, json!({})).await;
    assert_duplicate(&res, first_id, false);
    assert!(!upload_exists(&pool, second).await);
    assert!(!temp_exists(&app, second));
    assert_eq!(asset_count(&pool).await, 1);
    assert_eq!(std::fs::read(original_path(&app, &asset)).unwrap(), bytes);
}

#[sqlx::test(migrations = "./migrations")]
async fn duplicate_of_processing_is_409(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let bytes = fake_jpeg();
    let first_id = finalize_ok(&app, upload_bytes(&app, &bytes, "a.jpg").await).await;

    let second = upload_bytes(&app, &bytes, "b.jpg").await;
    assert_duplicate(&finalize(&app, second, json!({})).await, first_id, false);
    assert_eq!(asset_count(&pool).await, 1);
}

#[sqlx::test(migrations = "./migrations")]
async fn duplicate_of_trashed_reports_in_trash(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let bytes = fake_jpeg();
    let first_id = finalize_ok(&app, upload_bytes(&app, &bytes, "a.jpg").await).await;
    sqlx::query!(
        "UPDATE assets SET status = 'ready', deleted_at = now() WHERE id = $1",
        first_id
    )
    .execute(&pool)
    .await
    .unwrap();

    let second = upload_bytes(&app, &bytes, "b.jpg").await;
    assert_duplicate(&finalize(&app, second, json!({})).await, first_id, true);
}

#[sqlx::test(migrations = "./migrations")]
async fn duplicate_of_failed_replaces_it(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let bytes = fake_jpeg();
    let res = finalize(&app, upload_bytes(&app, &bytes, "a.jpg").await, json!({})).await;
    res.assert_status(StatusCode::CREATED);
    let first: Value = res.json();
    let first_id = asset_id(&first);
    set_status(&pool, first_id, "failed").await;
    sqlx::query!("UPDATE jobs SET status = 'failed'")
        .execute(&pool)
        .await
        .unwrap();
    let derivatives = storage::derivative_dir(app.data.path(), first_id);
    std::fs::create_dir_all(&derivatives).unwrap();
    std::fs::write(derivatives.join("thumb.webp"), b"x").unwrap();

    let res = finalize(&app, upload_bytes(&app, &bytes, "b.jpg").await, json!({})).await;
    res.assert_status(StatusCode::CREATED);
    let second: Value = res.json();
    let second_id = asset_id(&second);
    assert_ne!(second_id, first_id);
    assert_eq!(second["original_filename"], "b.jpg");

    let ids = sqlx::query_scalar!("SELECT id FROM assets")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(ids, vec![second_id]);
    let payloads = sqlx::query_scalar!("SELECT payload FROM jobs")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(payloads, vec![json!({ "asset_id": second_id })]);
    assert!(!original_path(&app, &first).exists());
    assert!(!derivatives.exists());
    assert_eq!(std::fs::read(original_path(&app, &second)).unwrap(), bytes);
}

#[sqlx::test(migrations = "./migrations")]
async fn unsupported_type_rejected(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let upload = upload_bytes(&app, b"just some plain text, not media", "a.txt").await;

    let res = finalize(&app, upload, json!({})).await;
    assert_error(&res, StatusCode::BAD_REQUEST, "upload.unsupportedType");
    assert!(!upload_exists(&pool, upload).await);
    assert!(!temp_exists(&app, upload));
    assert_eq!(asset_count(&pool).await, 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn incomplete_upload_rejected(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let upload = tus_create(&app, 10, "a.jpg").await;
    tus_patch(&app, upload, 0, &[0xFF, 0xD8, 0xFF, 0xE0, 0x00])
        .await
        .assert_status(StatusCode::NO_CONTENT);

    let res = finalize(&app, upload, json!({})).await;
    assert_error(&res, StatusCode::CONFLICT, "upload.incomplete");
    assert!(upload_exists(&pool, upload).await);
    assert!(temp_exists(&app, upload));
}

#[sqlx::test(migrations = "./migrations")]
async fn finalize_checks_owner_and_lock(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let upload = upload_bytes(&app, &fake_jpeg(), "a.jpg").await;

    let (dad, _) = app.login_as("dad", Role::Guardian).await;
    let res = finalize_as(&dad, upload, json!({})).await;
    assert_error(&res, StatusCode::NOT_FOUND, "upload.notFound");

    let guard = app.state.upload_locks.try_acquire(upload).unwrap();
    let res = finalize(&app, upload, json!({})).await;
    assert_error(&res, StatusCode::CONFLICT, "upload.locked");
    drop(guard);

    finalize_ok(&app, upload).await;
    let res = finalize(&app, upload, json!({})).await;
    assert_error(&res, StatusCode::NOT_FOUND, "upload.notFound");
}

#[sqlx::test(migrations = "./migrations")]
async fn baby_tags_applied(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let mut babies = Vec::new();
    for name in ["하늘", "바다"] {
        let res = app
            .server
            .post("/api/babies")
            .add_header(XRW, XRW_VALUE)
            .json(&json!({ "name": name, "birth_date": "2026-01-15" }))
            .await;
        res.assert_status(StatusCode::CREATED);
        babies.push(asset_id(&res.json()));
    }

    let upload = upload_bytes(&app, &fake_jpeg(), "a.jpg").await;
    let res = finalize(&app, upload, json!({ "baby_ids": babies })).await;
    res.assert_status(StatusCode::CREATED);
    let asset: Value = res.json();
    let got: HashSet<Uuid> = serde_json::from_value(asset["baby_ids"].clone()).unwrap();
    assert_eq!(got, babies.iter().copied().collect());
    let tags = sqlx::query!("SELECT baby_id, tagged_by FROM asset_babies")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(tags.len(), 2);
    assert!(tags.iter().all(|t| t.tagged_by == app.user.id));

    let upload = upload_bytes(&app, &fake_jpeg(), "b.jpg").await;
    let res = finalize(
        &app,
        upload,
        json!({ "baby_ids": [babies[0], Uuid::now_v7()] }),
    )
    .await;
    assert_error(&res, StatusCode::BAD_REQUEST, "asset.babyInvalid");
    assert_eq!(asset_count(&pool).await, 1);
    assert!(upload_exists(&pool, upload).await);
    assert!(temp_exists(&app, upload));

    finalize_ok(&app, upload).await;
}

#[sqlx::test(migrations = "./migrations")]
async fn concurrent_finalize_same_bytes(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let bytes = fake_jpeg();
    let a = upload_bytes(&app, &bytes, "a.jpg").await;
    let b = upload_bytes(&app, &bytes, "b.jpg").await;

    let (ra, rb) = tokio::join!(finalize(&app, a, json!({})), finalize(&app, b, json!({})));
    let codes: HashSet<u16> = [ra.status_code(), rb.status_code()]
        .iter()
        .map(|s| s.as_u16())
        .collect();
    assert_eq!(codes, HashSet::from([201, 409]));
    let (created, dup) = if ra.status_code() == StatusCode::CREATED {
        (ra, rb)
    } else {
        (rb, ra)
    };
    assert_duplicate(&dup, asset_id(&created.json()), false);
    assert_eq!(asset_count(&pool).await, 1);
    for id in [a, b] {
        assert!(!upload_exists(&pool, id).await);
        assert!(!temp_exists(&app, id));
    }
}

async fn create_baby(app: &MediaApp) -> Uuid {
    let res = app
        .server
        .post("/api/babies")
        .add_header(XRW, XRW_VALUE)
        .json(&json!({ "name": "하늘", "birth_date": "2024-01-01" }))
        .await;
    res.assert_status(StatusCode::CREATED);
    asset_id(&res.json())
}

async fn create_story(server: &TestServer, asset_ids: &[Uuid]) -> Uuid {
    let res = server
        .post("/api/stories")
        .add_header(XRW, XRW_VALUE)
        .json(&json!({
            "entry_date": "2024-06-01",
            "body": "이야기",
            "baby_ids": [],
            "asset_ids": asset_ids,
        }))
        .await;
    res.assert_status(StatusCode::CREATED);
    asset_id(&res.json())
}

async fn create_milestone(app: &MediaApp, baby: Uuid) -> Uuid {
    let res = app
        .server
        .post(&format!("/api/babies/{baby}/milestones"))
        .add_header(XRW, XRW_VALUE)
        .json(&json!({ "custom_label": "첫 눈", "achieved_on": "2024-06-01", "asset_ids": [] }))
        .await;
    res.assert_status(StatusCode::CREATED);
    asset_id(&res.json())
}

/// 위치 순 (asset_id, position). 휴지통 포함.
async fn story_links(pool: &PgPool, story: Uuid) -> Vec<(Uuid, i32)> {
    sqlx::query!(
        "SELECT asset_id, position FROM story_assets WHERE story_id = $1 ORDER BY position",
        story
    )
    .fetch_all(pool)
    .await
    .unwrap()
    .into_iter()
    .map(|r| (r.asset_id, r.position))
    .collect()
}

async fn milestone_links(pool: &PgPool, milestone: Uuid) -> Vec<(Uuid, i32)> {
    sqlx::query!(
        "SELECT asset_id, position FROM milestone_assets WHERE milestone_id = $1
         ORDER BY position",
        milestone
    )
    .fetch_all(pool)
    .await
    .unwrap()
    .into_iter()
    .map(|r| (r.asset_id, r.position))
    .collect()
}

async fn trash(pool: &PgPool, asset: Uuid) {
    sqlx::query!("UPDATE assets SET deleted_at = now() WHERE id = $1", asset)
        .execute(pool)
        .await
        .unwrap();
}

#[sqlx::test(migrations = "./migrations")]
async fn attach_story(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let p1 = finalize_ok(&app, upload_bytes(&app, &fake_jpeg(), "1.jpg").await).await;
    let p2 = finalize_ok(&app, upload_bytes(&app, &fake_jpeg(), "2.jpg").await).await;
    let story = create_story(&app.server, &[p1, p2]).await;
    // 휴지통 사진 위치도 맨 뒤 계산에 포함
    trash(&pool, p2).await;

    let upload = upload_bytes(&app, &fake_jpeg(), "3.jpg").await;
    let res = finalize(
        &app,
        upload,
        json!({ "attach": { "kind": "story", "id": story } }),
    )
    .await;
    res.assert_status(StatusCode::CREATED);
    let p3 = asset_id(&res.json());
    assert_eq!(story_links(&pool, story).await, [(p1, 0), (p2, 1), (p3, 2)]);

    let detail: Value = app
        .server
        .get(&format!("/api/stories/{story}"))
        .await
        .json();
    let shown: Vec<Uuid> = detail["assets"]
        .as_array()
        .unwrap()
        .iter()
        .map(asset_id)
        .collect();
    assert_eq!(shown, [p1, p3]);

    let upload = upload_bytes(&app, &fake_jpeg(), "4.jpg").await;
    let res = finalize(
        &app,
        upload,
        json!({ "attach": { "kind": "photo", "id": story } }),
    )
    .await;
    assert_error(&res, StatusCode::BAD_REQUEST, "request.invalidBody");
}

#[sqlx::test(migrations = "./migrations")]
async fn attach_milestone(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let baby = create_baby(&app).await;
    let milestone = create_milestone(&app, baby).await;

    let mut ids = Vec::new();
    for name in ["1.jpg", "2.jpg"] {
        let upload = upload_bytes(&app, &fake_jpeg(), name).await;
        let res = finalize(
            &app,
            upload,
            json!({ "attach": { "kind": "milestone", "id": milestone } }),
        )
        .await;
        res.assert_status(StatusCode::CREATED);
        ids.push(asset_id(&res.json()));
    }
    assert_eq!(
        milestone_links(&pool, milestone).await,
        [(ids[0], 0), (ids[1], 1)]
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn attach_target_gone_skips(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let story = create_story(&app.server, &[]).await;
    app.server
        .delete(&format!("/api/stories/{story}"))
        .add_header(XRW, XRW_VALUE)
        .await
        .assert_status(StatusCode::NO_CONTENT);

    for kind in ["story", "milestone"] {
        let upload = upload_bytes(&app, &fake_jpeg(), "a.jpg").await;
        let res = finalize(
            &app,
            upload,
            json!({ "attach": { "kind": kind, "id": story } }),
        )
        .await;
        res.assert_status(StatusCode::CREATED);
        assert!(!upload_exists(&pool, upload).await);
    }
    assert_eq!(asset_count(&pool).await, 2);
    let links = sqlx::query_scalar!(
        r#"SELECT (SELECT count(*) FROM story_assets) + (SELECT count(*) FROM milestone_assets)
             AS "n!""#
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(links, 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn attach_without_permission_skips(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let (dad, _) = app.login_as("dad", Role::Guardian).await;
    let story = create_story(&dad, &[]).await;

    let upload = upload_bytes(&app, &fake_jpeg(), "a.jpg").await;
    let res = finalize(
        &app,
        upload,
        json!({ "attach": { "kind": "story", "id": story } }),
    )
    .await;
    res.assert_status(StatusCode::CREATED);
    assert_eq!(story_links(&pool, story).await, []);
}

#[sqlx::test(migrations = "./migrations")]
async fn duplicate_attaches_existing(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let bytes = fake_jpeg();
    let existing = finalize_ok(&app, upload_bytes(&app, &bytes, "a.jpg").await).await;
    let other = finalize_ok(&app, upload_bytes(&app, &fake_jpeg(), "o.jpg").await).await;
    let story = create_story(&app.server, &[other]).await;

    let upload = upload_bytes(&app, &bytes, "b.jpg").await;
    let res = finalize(
        &app,
        upload,
        json!({ "attach": { "kind": "story", "id": story } }),
    )
    .await;
    assert_duplicate(&res, existing, false);
    assert!(!upload_exists(&pool, upload).await);
    assert_eq!(story_links(&pool, story).await, [(other, 0), (existing, 1)]);

    // 이미 연결된 사진은 그대로
    let upload = upload_bytes(&app, &bytes, "c.jpg").await;
    let res = finalize(
        &app,
        upload,
        json!({ "attach": { "kind": "story", "id": story } }),
    )
    .await;
    assert_duplicate(&res, existing, false);
    assert_eq!(story_links(&pool, story).await, [(other, 0), (existing, 1)]);

    // 휴지통 사진은 연결 안 함
    let baby = create_baby(&app).await;
    let milestone = create_milestone(&app, baby).await;
    trash(&pool, existing).await;
    let upload = upload_bytes(&app, &bytes, "d.jpg").await;
    let res = finalize(
        &app,
        upload,
        json!({ "attach": { "kind": "milestone", "id": milestone } }),
    )
    .await;
    assert_duplicate(&res, existing, true);
    assert_eq!(milestone_links(&pool, milestone).await, []);
}

#[sqlx::test(migrations = "./migrations")]
async fn concurrent_duplicate_attaches_once(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let story = create_story(&app.server, &[]).await;
    let bytes = fake_jpeg();
    let a = upload_bytes(&app, &bytes, "a.jpg").await;
    let b = upload_bytes(&app, &bytes, "b.jpg").await;

    let body = json!({ "attach": { "kind": "story", "id": story } });
    let (ra, rb) = tokio::join!(
        finalize(&app, a, body.clone()),
        finalize(&app, b, body.clone())
    );
    let created = if ra.status_code() == StatusCode::CREATED {
        assert_duplicate(&rb, asset_id(&ra.json()), false);
        ra
    } else {
        assert_duplicate(&ra, asset_id(&rb.json()), false);
        rb
    };
    assert_eq!(asset_count(&pool).await, 1);
    assert_eq!(
        story_links(&pool, story).await,
        [(asset_id(&created.json()), 0)]
    );
}

async fn create_album(app: &MediaApp) -> Uuid {
    let res = app
        .server
        .post("/api/albums")
        .add_header(XRW, XRW_VALUE)
        .json(&json!({ "name": "앨범" }))
        .await;
    res.assert_status(StatusCode::CREATED);
    asset_id(&res.json())
}

async fn album_assets(pool: &PgPool, album: Uuid) -> Vec<Uuid> {
    sqlx::query_scalar!(
        "SELECT asset_id FROM album_assets WHERE album_id = $1 ORDER BY asset_id",
        album
    )
    .fetch_all(pool)
    .await
    .unwrap()
}

#[sqlx::test(migrations = "./migrations")]
async fn attach_album(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let album = create_album(&app).await;
    let upload = upload_bytes(&app, &fake_jpeg(), "a.jpg").await;
    let res = finalize(
        &app,
        upload,
        json!({ "attach": { "kind": "album", "id": album } }),
    )
    .await;
    res.assert_status(StatusCode::CREATED);
    assert_eq!(album_assets(&pool, album).await, [asset_id(&res.json())]);
}

#[sqlx::test(migrations = "./migrations")]
async fn attach_album_gone_skips(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let album = create_album(&app).await;
    app.server
        .delete(&format!("/api/albums/{album}"))
        .add_header(XRW, XRW_VALUE)
        .await
        .assert_status(StatusCode::NO_CONTENT);
    let upload = upload_bytes(&app, &fake_jpeg(), "a.jpg").await;
    let res = finalize(
        &app,
        upload,
        json!({ "attach": { "kind": "album", "id": album } }),
    )
    .await;
    res.assert_status(StatusCode::CREATED);
    let links = sqlx::query_scalar!(r#"SELECT count(*) AS "n!" FROM album_assets"#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(links, 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn attach_album_duplicate(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let bytes = fake_jpeg();
    let existing = finalize_ok(&app, upload_bytes(&app, &bytes, "a.jpg").await).await;
    let album = create_album(&app).await;
    let upload = upload_bytes(&app, &bytes, "b.jpg").await;
    let res = finalize(
        &app,
        upload,
        json!({ "attach": { "kind": "album", "id": album } }),
    )
    .await;
    assert_duplicate(&res, existing, false);
    assert_eq!(album_assets(&pool, album).await, [existing]);
}
