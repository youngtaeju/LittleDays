mod common;

use std::{path::PathBuf, time::Duration};

use axum::http::StatusCode;
use axum_test::TestResponse;
use chrono::{DateTime, Utc};
use common::{
    AssetSeed, MediaApp, XRW, XRW_VALUE, assert_error, insert_asset, media_app, upload_bytes,
};
use littledays::{
    assets::{self, Asset, AssetStatus, TakenAtSource},
    jobs::{self, Job, worker},
    media::storage,
    settings,
    users::Role,
};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

fn fixture(name: &str) -> Vec<u8> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name);
    std::fs::read(path).unwrap()
}

fn at(s: &str) -> DateTime<Utc> {
    s.parse().unwrap()
}

/// `FF D8 FF` 로 시작하는 가짜 JPEG. 형식 판별만 통과, 디코드 불가.
fn corrupt_jpeg() -> Vec<u8> {
    let mut bytes = vec![0xFF, 0xD8, 0xFF, 0xE0];
    bytes.extend(rand::random::<[u8; 60]>());
    bytes
}

/// 업로드 + finalize. 201 확인 후 asset id.
async fn ingest(app: &MediaApp, bytes: &[u8], filename: &str, body: Value) -> Uuid {
    let upload = upload_bytes(app, bytes, filename).await;
    let res = app
        .server
        .post(&format!("/api/uploads/{upload}/finalize"))
        .add_header(XRW, XRW_VALUE)
        .json(&body)
        .await;
    res.assert_status(StatusCode::CREATED);
    res.json::<Value>()["id"].as_str().unwrap().parse().unwrap()
}

/// 잡 1개 처리. 큐에 잡이 있었는지 확인.
async fn run_one(app: &MediaApp) {
    assert!(worker::run_next(&app.state).await.unwrap());
}

async fn asset(app: &MediaApp, id: Uuid) -> Asset {
    assets::queries::get(&app.state.pool, id, app.user.id)
        .await
        .unwrap()
        .unwrap()
}

fn derivative(app: &MediaApp, id: Uuid, file: &str) -> PathBuf {
    storage::derivative_dir(app.data.path(), id).join(file)
}

async fn set_setting(pool: &PgPool, key: &str, value: Value) {
    settings::queries::set(pool, key, value).await.unwrap();
}

struct JobRow {
    status: String,
    last_error: Option<String>,
}

async fn job_rows(pool: &PgPool) -> Vec<JobRow> {
    sqlx::query_as!(
        JobRow,
        r#"SELECT status::text AS "status!", last_error FROM jobs ORDER BY created_at"#
    )
    .fetch_all(pool)
    .await
    .unwrap()
}

async fn retry(app: &MediaApp, id: Uuid) -> TestResponse {
    app.server
        .post(&format!("/api/assets/{id}/retry"))
        .add_header(XRW, XRW_VALUE)
        .await
}

#[sqlx::test(migrations = "./migrations")]
async fn photo_becomes_ready_with_exif(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let id = ingest(&app, &fixture("orient6.jpg"), "a.jpg", json!({})).await;
    run_one(&app).await;

    let a = asset(&app, id).await;
    assert_eq!(a.status, AssetStatus::Ready);
    assert_eq!(a.processing_error, None);
    assert_eq!((a.width, a.height), (Some(240), Some(320)));
    for file in ["thumb.webp", "preview.webp", "large.webp"] {
        assert!(derivative(&app, id, file).is_file(), "{file}");
    }
    assert_eq!(a.derivatives["thumb"]["formats"], json!(["webp"]));
    assert_eq!(a.derivatives["preview"]["formats"], json!(["webp"]));
    assert_eq!(a.taken_at, at("2024-05-01T01:20:30Z"));
    assert_eq!(a.taken_at_source, TakenAtSource::Exif);
    assert_eq!(a.camera_make.as_deref(), Some("TestMake"));
    assert_eq!(a.camera_model.as_deref(), Some("TestModel"));
    assert!((a.gps_lat.unwrap() - 37.5665).abs() < 1e-4);
    assert!((a.gps_lon.unwrap() - 126.978).abs() < 1e-4);
    assert!(a.blurhash.is_some());
    assert!(a.dominant_color.unwrap().starts_with('#'));
    assert!(job_rows(&pool).await.is_empty());
}

#[sqlx::test(migrations = "./migrations")]
async fn naive_exif_uses_instance_timezone(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    set_setting(&pool, "timezone", json!("UTC")).await;
    let id = ingest(&app, &fixture("orient6.jpg"), "a.jpg", json!({})).await;
    run_one(&app).await;

    let a = asset(&app, id).await;
    assert_eq!(a.taken_at, at("2024-05-01T10:20:30Z"));
    assert_eq!(a.taken_at_source, TakenAtSource::Exif);
}

#[sqlx::test(migrations = "./migrations")]
async fn exif_offset_wins_over_timezone(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let id = ingest(&app, &fixture("offset.jpg"), "a.jpg", json!({})).await;
    run_one(&app).await;

    let a = asset(&app, id).await;
    assert_eq!(a.status, AssetStatus::Ready);
    assert_eq!(a.taken_at, at("2024-05-01T08:20:30Z"));
    assert_eq!(a.taken_at_source, TakenAtSource::Exif);
}

#[sqlx::test(migrations = "./migrations")]
async fn png_keeps_file_mtime(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let mtime = "2023-03-04T05:06:07Z";
    let body = json!({ "file_modified_at": mtime });
    let id = ingest(&app, &fixture("plain.png"), "a.png", body).await;
    run_one(&app).await;

    let a = asset(&app, id).await;
    assert_eq!(a.status, AssetStatus::Ready);
    assert_eq!((a.width, a.height), (Some(300), Some(200)));
    assert_eq!(a.taken_at, at(mtime));
    assert_eq!(a.taken_at_source, TakenAtSource::FileMtime);
    assert_eq!(a.camera_make, None);
    assert_eq!(a.gps_lat, None);
}

#[sqlx::test(migrations = "./migrations")]
async fn import_source_is_not_overridden(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let id = ingest(&app, &fixture("orient6.jpg"), "a.jpg", json!({})).await;
    let imported = at("2020-01-02T03:04:05Z");
    sqlx::query!(
        "UPDATE assets SET taken_at = $2, taken_at_source = 'import' WHERE id = $1",
        id,
        imported
    )
    .execute(&pool)
    .await
    .unwrap();
    run_one(&app).await;

    let a = asset(&app, id).await;
    assert_eq!(a.status, AssetStatus::Ready);
    assert_eq!(a.taken_at, imported);
    assert_eq!(a.taken_at_source, TakenAtSource::Import);
    assert_eq!(a.camera_make.as_deref(), Some("TestMake"));
}

#[sqlx::test(migrations = "./migrations")]
async fn heic_is_processed(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let id = ingest(&app, &fixture("rotated.heic"), "a.heic", json!({})).await;
    run_one(&app).await;

    let a = asset(&app, id).await;
    assert_eq!(a.status, AssetStatus::Ready, "{:?}", a.processing_error);
    assert_eq!((a.width, a.height), (Some(240), Some(320)));
    assert!(derivative(&app, id, "thumb.webp").is_file());
}

#[sqlx::test(migrations = "./migrations")]
async fn avif_setting_adds_preview_avif(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    set_setting(&pool, "derivatives_avif", json!(true)).await;
    let id = ingest(&app, &fixture("plain.png"), "a.png", json!({})).await;
    run_one(&app).await;

    let a = asset(&app, id).await;
    assert_eq!(a.status, AssetStatus::Ready, "{:?}", a.processing_error);
    assert!(derivative(&app, id, "preview.avif").is_file());
    assert_eq!(a.derivatives["preview"]["formats"], json!(["webp", "avif"]));
}

#[sqlx::test(migrations = "./migrations")]
async fn video_direct_play(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let id = ingest(&app, &fixture("clip-h264.mp4"), "a.mp4", json!({})).await;
    run_one(&app).await;

    let a = asset(&app, id).await;
    assert_eq!(a.status, AssetStatus::Ready, "{:?}", a.processing_error);
    assert_eq!((a.width, a.height), (Some(160), Some(120)));
    assert!((1900..=2100).contains(&a.duration_ms.unwrap()));
    assert_eq!(a.taken_at, at("2024-06-01T03:00:00Z"));
    assert_eq!(a.taken_at_source, TakenAtSource::VideoMeta);
    assert!(a.derivatives["playback"].is_null());
    assert!(!derivative(&app, id, "playback.mp4").exists());
    for file in ["thumb.webp", "preview.webp", "large.webp"] {
        assert!(derivative(&app, id, file).is_file(), "{file}");
    }
    assert!(a.blurhash.is_some());
}

#[sqlx::test(migrations = "./migrations")]
async fn video_needs_transcode(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let id = ingest(&app, &fixture("clip-hevc.mov"), "a.mov", json!({})).await;
    run_one(&app).await;

    let a = asset(&app, id).await;
    assert_eq!(a.status, AssetStatus::Ready, "{:?}", a.processing_error);
    assert_eq!((a.width, a.height), (Some(120), Some(160)));
    assert!(derivative(&app, id, "playback.mp4").is_file());
    let dir = storage::derivative_dir(app.data.path(), id);
    let names: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert!(
        names
            .iter()
            .all(|n| !n.contains("tmp") && !n.ends_with(".part")),
        "{names:?}"
    );
    assert_eq!(
        a.derivatives["playback"],
        json!({ "width": 120, "height": 160, "formats": ["mp4"] })
    );
    assert_eq!(a.taken_at_source, TakenAtSource::VideoMeta);
}

#[sqlx::test(migrations = "./migrations")]
async fn corrupt_file_fails(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let id = ingest(&app, &corrupt_jpeg(), "a.jpg", json!({})).await;
    run_one(&app).await;

    let a = asset(&app, id).await;
    assert_eq!(a.status, AssetStatus::Failed);
    let err = a.processing_error.unwrap();
    assert!(!err.is_empty());
    assert!(err.chars().count() <= 500 && !err.contains('\n'), "{err}");
    let jobs = job_rows(&pool).await;
    assert_eq!(jobs.len(), 1);
    assert_eq!(jobs[0].status, "failed");
    assert!(!jobs[0].last_error.as_deref().unwrap_or_default().is_empty());
    // 자동 재시도 없음.
    assert!(!worker::run_next(&app.state).await.unwrap());
}

#[sqlx::test(migrations = "./migrations")]
async fn missing_original_fails(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let id = ingest(&app, &fixture("plain.png"), "a.png", json!({})).await;
    let rel = sqlx::query_scalar!("SELECT original_path FROM assets WHERE id = $1", id)
        .fetch_one(&pool)
        .await
        .unwrap();
    std::fs::remove_file(app.data.path().join(rel)).unwrap();
    run_one(&app).await;

    let a = asset(&app, id).await;
    assert_eq!(a.status, AssetStatus::Failed);
    assert!(
        a.processing_error.as_deref().unwrap().contains("original"),
        "{:?}",
        a.processing_error
    );
    assert_eq!(job_rows(&pool).await[0].status, "failed");
}

#[cfg(unix)]
#[sqlx::test(migrations = "./migrations")]
async fn processing_error_has_no_absolute_path(pool: PgPool) {
    use std::os::unix::fs::PermissionsExt;

    let app = media_app(&pool, Role::Guardian).await;
    let id = ingest(&app, &fixture("plain.png"), "a.png", json!({})).await;
    let rel = sqlx::query_scalar!("SELECT original_path FROM assets WHERE id = $1", id)
        .fetch_one(&pool)
        .await
        .unwrap();
    // 읽기 불가 원본: 디코드 open 에러 문구에 절대 경로 포함.
    let original = app.data.path().join(rel);
    std::fs::set_permissions(&original, std::fs::Permissions::from_mode(0o000)).unwrap();
    if std::fs::File::open(&original).is_ok() {
        // root 는 권한 무시.
        return;
    }
    run_one(&app).await;

    let err = asset(&app, id).await.processing_error.unwrap();
    assert!(err.contains("DATA_DIR"), "{err}");
    let data_dir = app.data.path().to_string_lossy().into_owned();
    assert!(!err.contains(&data_dir), "{err}");
}

#[sqlx::test(migrations = "./migrations")]
async fn vanished_asset_finishes_quietly(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let id = ingest(&app, &fixture("plain.png"), "a.png", json!({})).await;
    sqlx::query!("DELETE FROM assets WHERE id = $1", id)
        .execute(&pool)
        .await
        .unwrap();
    run_one(&app).await;

    assert!(job_rows(&pool).await.is_empty());
    assert!(!storage::derivative_dir(app.data.path(), id).exists());
}

#[sqlx::test(migrations = "./migrations")]
async fn retry_requeues_failed(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let failed = ingest(&app, &corrupt_jpeg(), "a.jpg", json!({})).await;
    run_one(&app).await;
    // finalize 가 남긴 깨움 permit 소진. 아래 확인이 retry 의 notify 만 보게.
    let _ = tokio::time::timeout(Duration::from_millis(50), app.state.jobs_wake.notified()).await;

    let res = retry(&app, failed).await;
    res.assert_status(StatusCode::ACCEPTED);
    let body: Value = res.json();
    assert_eq!(body["id"], json!(failed));
    assert_eq!(body["status"], "processing");
    assert_eq!(body["processing_error"], Value::Null);
    let jobs = job_rows(&pool).await;
    assert_eq!(jobs.len(), 1);
    assert_eq!(jobs[0].status, "queued");
    assert_eq!(jobs[0].last_error, None);
    tokio::time::timeout(Duration::from_secs(1), app.state.jobs_wake.notified())
        .await
        .expect("워커 깨움");

    // 재시도 중(processing)도 409.
    assert_error(
        &retry(&app, failed).await,
        StatusCode::CONFLICT,
        "asset.notFailed",
    );

    let ready = insert_asset(&pool, AssetSeed::photo(app.user.id)).await;
    assert_error(
        &retry(&app, ready).await,
        StatusCode::CONFLICT,
        "asset.notFailed",
    );
    assert_error(
        &retry(&app, Uuid::now_v7()).await,
        StatusCode::NOT_FOUND,
        "asset.notFound",
    );

    let (family, _) = app.login_as("grandma", Role::Family).await;
    let res = family
        .post(&format!("/api/assets/{failed}/retry"))
        .add_header(XRW, XRW_VALUE)
        .await;
    assert_error(&res, StatusCode::FORBIDDEN, "auth.forbidden");
}

#[sqlx::test(migrations = "./migrations")]
async fn retry_clears_stale_derivatives(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    set_setting(&pool, "derivatives_avif", json!(true)).await;
    let id = ingest(&app, &fixture("plain.png"), "a.png", json!({})).await;
    run_one(&app).await;
    assert!(derivative(&app, id, "preview.avif").is_file());

    set_setting(&pool, "derivatives_avif", json!(false)).await;
    sqlx::query!("UPDATE assets SET status = 'failed' WHERE id = $1", id)
        .execute(&pool)
        .await
        .unwrap();
    retry(&app, id).await.assert_status(StatusCode::ACCEPTED);
    run_one(&app).await;

    let a = asset(&app, id).await;
    assert_eq!(a.status, AssetStatus::Ready);
    assert!(!derivative(&app, id, "preview.avif").exists());
    assert!(derivative(&app, id, "preview.webp").is_file());
    assert_eq!(a.derivatives["preview"]["formats"], json!(["webp"]));
}

#[sqlx::test(migrations = "./migrations")]
async fn requeue_running_resets(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let id = ingest(&app, &fixture("plain.png"), "a.png", json!({})).await;
    sqlx::query!("UPDATE jobs SET status = 'running', locked_at = now()")
        .execute(&pool)
        .await
        .unwrap();
    assert!(jobs::claim(&pool).await.unwrap().is_none());

    assert_eq!(jobs::requeue_running(&pool).await.unwrap(), 1);
    let claimed = jobs::claim(&pool).await.unwrap().unwrap();
    assert_eq!(claimed.job, Job::ProcessAsset { asset_id: id });
    assert_eq!(claimed.attempts, 1);
    assert_eq!(job_rows(&pool).await[0].status, "running");
}

#[sqlx::test(migrations = "./migrations")]
async fn repeatedly_interrupted_job_fails(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let id = ingest(&app, &fixture("plain.png"), "a.png", json!({})).await;
    sqlx::query!("UPDATE jobs SET status = 'running', locked_at = now(), attempts = 3")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(jobs::requeue_running(&pool).await.unwrap(), 1);
    assert!(worker::run_next(&app.state).await.unwrap());

    let a = asset(&app, id).await;
    assert_eq!(a.status, AssetStatus::Failed);
    assert!(
        a.processing_error
            .as_deref()
            .unwrap()
            .contains("interrupted repeatedly (attempts 4)"),
        "{:?}",
        a.processing_error
    );
    assert_eq!(job_rows(&pool).await[0].status, "failed");
}

#[sqlx::test(migrations = "./migrations")]
async fn empty_queue_returns_false(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    assert!(!worker::run_next(&app.state).await.unwrap());
}

#[sqlx::test(migrations = "./migrations")]
async fn spawned_workers_process_and_stop(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let (stop_tx, stop_rx) = tokio::sync::watch::channel(false);
    let handles = worker::spawn(app.state.clone(), 2, stop_rx);
    assert_eq!(handles.len(), 2);

    // 유휴 대기 중인 워커를 finalize 의 notify 가 깨움 (5초 폴링보다 빠름).
    let id = ingest(&app, &fixture("plain.png"), "a.png", json!({})).await;
    tokio::time::timeout(Duration::from_secs(4), async {
        while asset(&app, id).await.status != AssetStatus::Ready {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("처리 완료");

    stop_tx.send(true).unwrap();
    for handle in handles {
        tokio::time::timeout(Duration::from_secs(2), handle)
            .await
            .expect("워커 종료")
            .unwrap();
    }
}

#[sqlx::test(migrations = "./migrations")]
async fn asset_vanishing_mid_failure_finishes_job(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let id = ingest(&app, &corrupt_jpeg(), "a.jpg", json!({})).await;

    // 미커밋 삭제로 행 잠금 보유. 워커는 조회·디코드 실패까지 진행 후 실패 기록 UPDATE 에서 대기.
    let mut tx = pool.begin().await.unwrap();
    sqlx::query!("DELETE FROM assets WHERE id = $1", id)
        .execute(&mut *tx)
        .await
        .unwrap();
    let state = app.state.clone();
    let worker = tokio::spawn(async move { worker::run_next(&state).await });
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let waiting = sqlx::query_scalar!(
                r#"SELECT count(*) AS "n!" FROM pg_stat_activity
                   WHERE datname = current_database() AND wait_event_type = 'Lock'"#
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            if waiting > 0 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("워커가 실패 기록에서 잠금 대기");
    tx.commit().await.unwrap();

    assert!(worker.await.unwrap().unwrap());
    assert!(job_rows(&pool).await.is_empty());
    assert!(!storage::derivative_dir(app.data.path(), id).exists());
}
