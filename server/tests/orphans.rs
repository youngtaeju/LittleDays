mod common;

use std::{
    fs::{self, File},
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};

use chrono::{TimeZone, Utc};
use common::{AssetSeed, MediaApp, insert_asset, media_app};
use littledays::{
    maintenance,
    media::{orphans, storage},
    users::Role,
};
use sqlx::PgPool;
use uuid::Uuid;

const GRACE: Duration = Duration::from_secs(24 * 3600);

fn age(path: &Path, by: Duration) {
    File::open(path)
        .unwrap()
        .set_modified(SystemTime::now() - by)
        .unwrap();
}

const OLD: Duration = Duration::from_secs(48 * 3600);

fn write(path: &Path) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, b"x").unwrap();
}

fn original(app: &MediaApp, id: Uuid, old: bool) -> PathBuf {
    let at = Utc.with_ymd_and_hms(2026, 11, 6, 0, 0, 0).unwrap();
    let path = app
        .data
        .path()
        .join(storage::original_rel_path(at, id, "jpg"));
    write(&path);
    if old {
        age(&path, OLD);
    }
    path
}

fn temp(app: &MediaApp, id: Uuid, old: bool) -> PathBuf {
    let path = storage::upload_temp_path(app.data.path(), id);
    write(&path);
    if old {
        age(&path, OLD);
    }
    path
}

fn derivatives(app: &MediaApp, id: Uuid, old: bool) -> PathBuf {
    let dir = storage::derivative_dir(app.data.path(), id);
    write(&dir.join("thumb.webp"));
    if old {
        age(&dir, OLD);
    }
    dir
}

async fn insert_upload(pool: &PgPool, app: &MediaApp, id: Uuid) {
    sqlx::query!(
        "INSERT INTO uploads (id, user_id, length, expires_at)
         VALUES ($1, $2, 1, now() + interval '1 hour')",
        id,
        app.user.id,
    )
    .execute(pool)
    .await
    .expect("insert upload");
}

async fn insert_seed_asset(pool: &PgPool, app: &MediaApp, id: Uuid) {
    let mut seed = AssetSeed::photo(app.user.id);
    seed.id = id;
    seed.created_at = Utc.with_ymd_and_hms(2026, 11, 6, 0, 0, 0).unwrap();
    seed.original_path = storage::original_rel_path(seed.created_at, id, "jpg")
        .to_string_lossy()
        .into_owned();
    insert_asset(pool, seed).await;
}

#[sqlx::test(migrations = "./migrations")]
async fn sweeps_only_old_unreferenced(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;

    // 참조 있음(오래됨), 참조 없음(새것), 참조 없음(오래됨) 순.
    let (t_ref, t_new, t_old) = (Uuid::now_v7(), Uuid::now_v7(), Uuid::now_v7());
    insert_upload(&pool, &app, t_ref).await;
    let temps = [
        temp(&app, t_ref, true),
        temp(&app, t_new, false),
        temp(&app, t_old, true),
    ];

    let (a_ref, a_new, a_old) = (Uuid::now_v7(), Uuid::now_v7(), Uuid::now_v7());
    insert_seed_asset(&pool, &app, a_ref).await;
    let derivs = [
        derivatives(&app, a_ref, true),
        derivatives(&app, a_new, false),
        derivatives(&app, a_old, true),
    ];

    let (o_ref, o_new, o_old) = (Uuid::now_v7(), Uuid::now_v7(), Uuid::now_v7());
    insert_seed_asset(&pool, &app, o_ref).await;
    let originals = [
        original(&app, o_ref, true),
        original(&app, o_new, false),
        original(&app, o_old, true),
    ];

    let report = orphans::sweep(&app.state, GRACE).await.expect("sweep");

    assert_eq!(
        report,
        orphans::SweepReport {
            temp_removed: 1,
            derivatives_removed: 1,
            originals_moved: 1
        }
    );
    assert_eq!(temps.map(|p| p.exists()), [true, true, false]);
    assert_eq!(derivs.map(|p| p.exists()), [true, true, false]);
    assert_eq!(originals.map(|p| p.exists()), [true, true, false]);
}

#[sqlx::test(migrations = "./migrations")]
async fn originals_are_moved_not_deleted(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    // 빈 assets 가드 회피용 무관한 행.
    insert_seed_asset(&pool, &app, Uuid::now_v7()).await;
    let id = Uuid::now_v7();
    let path = original(&app, id, true);

    orphans::sweep(&app.state, GRACE).await.expect("sweep");

    assert!(!path.exists());
    let moved = app
        .data
        .path()
        .join(format!("orphans/originals/2026/11/{id}.jpg"));
    assert_eq!(fs::read(moved).unwrap(), b"x");
}

#[sqlx::test(migrations = "./migrations")]
async fn non_uuid_names_untouched(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let root = app.data.path();
    let stray = [
        root.join("tmp/uploads/notes.part"),
        root.join("tmp/uploads/readme.txt"),
        root.join("originals/2026/11/not-a-uuid.jpg"),
        root.join("originals/2026/11/noext"),
        root.join("originals/loose.jpg"),
        root.join("derivatives/not-a-uuid/thumb.webp"),
    ];
    for path in &stray {
        write(path);
        age(path, OLD);
    }
    age(&root.join("derivatives/not-a-uuid"), OLD);
    // uuid 이름이어도 확장자가 다른 임시 파일은 대상 아님.
    let other_ext = root.join(format!("tmp/uploads/{}.txt", Uuid::now_v7()));
    write(&other_ext);
    age(&other_ext, OLD);

    let report = orphans::sweep(&app.state, GRACE).await.expect("sweep");

    assert_eq!(report, orphans::SweepReport::default());
    assert!(stray.iter().all(|p| p.exists()));
    assert!(other_ext.exists());
    assert!(!root.join("orphans").exists());
}

#[sqlx::test(migrations = "./migrations")]
async fn run_once_sweeps_orphans(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let id = Uuid::now_v7();
    let path = temp(&app, id, true);

    maintenance::run_once(&app.state).await.expect("run_once");

    assert!(!path.exists());
}

#[sqlx::test(migrations = "./migrations")]
async fn run_once_sweeps_even_if_earlier_step_fails(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let id = Uuid::now_v7();
    let path = temp(&app, id, true);
    // 휴지통 단계가 설정 조회 실패로 에러.
    sqlx::query!("ALTER TABLE settings RENAME TO settings_gone")
        .execute(&pool)
        .await
        .expect("break trash step");

    let result = maintenance::run_once(&app.state).await;

    assert!(result.is_err());
    assert!(!path.exists());
}

#[sqlx::test(migrations = "./migrations")]
async fn empty_assets_table_skips_originals_and_derivatives(pool: PgPool) {
    let app = media_app(&pool, Role::Guardian).await;
    let original = original(&app, Uuid::now_v7(), true);
    let derivs = derivatives(&app, Uuid::now_v7(), true);
    let part = temp(&app, Uuid::now_v7(), true);

    let report = orphans::sweep(&app.state, GRACE).await.expect("sweep");

    assert_eq!(
        report,
        orphans::SweepReport {
            temp_removed: 1,
            derivatives_removed: 0,
            originals_moved: 0
        }
    );
    assert!(original.exists() && derivs.exists() && !part.exists());
}
