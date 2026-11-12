//! tus 완료 후 자산 생성: 형식 판별, 해시, 중복 판정, 원본 이동, 처리 작업 등록.

use std::{io, path::Path as FsPath};

use anyhow::Context;
use axum::{Json as AxumJson, extract::State, http::StatusCode};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgConnection;
use tokio::{io::AsyncReadExt, sync::OwnedMutexGuard};
use utoipa::ToSchema;
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use super::{Upload, queries, remove_temp_file};
use crate::{
    assets::{
        self, Asset, AssetStatus, TakenAtSource,
        queries::{NewAsset, ShaMatch},
    },
    auth::extract::CurrentUser,
    babies,
    error::{AppError, AppResult, ErrorBody},
    jobs::{self, Job},
    links::{self, LinkKind},
    media::{
        hash::sha256_file,
        sniff::{MediaType, sniff},
        storage,
    },
    milestones,
    request::{Json, Path},
    state::AppState,
    stories,
    users::Role,
};

/// 형식 판별에 읽는 앞부분 길이.
const SNIFF_LEN: u64 = 64;

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(finalize_upload))
}

#[derive(Deserialize, ToSchema)]
pub struct FinalizeRequest {
    /// 태그할 아기. 모르는 ID 가 하나라도 있으면 거부.
    #[serde(default)]
    baby_ids: Vec<Uuid>,
    /// 클라이언트 파일 수정 시각. 촬영 메타데이터 없을 때 촬영일 후보.
    file_modified_at: Option<DateTime<Utc>>,
    /// 맨 뒤에 붙일 이야기 또는 마일스톤. 대상이 없거나 고칠 권한이 없으면 연결만 건너뜀.
    /// 중복 업로드(409)면 기존 사진이 휴지통 아닐 때 연결.
    #[serde(default)]
    attach: Option<AttachTarget>,
}

/// 새 사진을 붙일 이야기 또는 마일스톤.
#[derive(Deserialize, ToSchema)]
pub struct AttachTarget {
    kind: LinkKind,
    id: Uuid,
}

#[utoipa::path(
    post,
    path = "/api/uploads/{id}/finalize",
    params(("id" = Uuid, Path, description = "업로드 ID")),
    request_body = FinalizeRequest,
    responses(
        (status = 201, description = "자산 생성 (`processing`). 업로드 행·임시 파일 제거", body = Asset),
        (status = 400, description = "본문·ID 형식 오류, 지원하지 않는 형식(`upload.unsupportedType`, 업로드 삭제), 모르는 아기(`asset.babyInvalid`, 업로드 유지)", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 403, description = "guardian 이상 아님 또는 CSRF 헤더 누락", body = ErrorBody),
        (status = 404, description = "업로드 없음·만료·다른 사용자 소유", body = ErrorBody),
        (status = 409, description = "같은 파일 존재(`asset.duplicate`, params `asset_id`·`in_trash`, 업로드 삭제), 미완료(`upload.incomplete`), PATCH·finalize 진행 중(`upload.locked`)", body = ErrorBody),
    )
)]
async fn finalize_upload(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(id): Path<Uuid>,
    Json(req): Json<FinalizeRequest>,
) -> AppResult<(StatusCode, AxumJson<Asset>)> {
    current.require(Role::Guardian)?;
    let upload = queries::find_for_user(&state.pool, id, current.user.id)
        .await?
        .ok_or(AppError::NotFound("upload.notFound"))?;
    let guard = state
        .upload_locks
        .try_acquire(id)
        .ok_or_else(|| AppError::conflict("upload.locked"))?;
    let temp = storage::upload_temp_path(&state.config.data_dir, id);
    let Some((len, head)) = read_head(&temp).await.context("read upload temp file")? else {
        // 조회 후 락 획득 전에 삭제·finalize 된 경우. 새로 생긴 락 항목 정리.
        state.upload_locks.remove(id);
        return Err(AppError::NotFound("upload.notFound"));
    };
    if u64::try_from(upload.length).ok() != Some(len) {
        return Err(AppError::conflict("upload.incomplete"));
    }
    if !req.baby_ids.is_empty() {
        let known = babies::queries::all_ids(&state.pool).await?;
        if !req.baby_ids.iter().all(|baby| known.contains(baby)) {
            return Err(AppError::bad_request("asset.babyInvalid"));
        }
    }
    let Some(media) = sniff(&head) else {
        discard_upload(&state, id).await?;
        return Err(AppError::bad_request("upload.unsupportedType"));
    };
    let sha256 = tokio::task::spawn_blocking({
        let temp = temp.clone();
        move || sha256_file(&temp)
    })
    .await
    .context("hash task")?
    .context("hash upload")?;

    // 이후 트랜잭션~커밋·원위치 복구·락 해제는 분리 태스크에서 끝까지 실행.
    // 핸들러 취소(연결 끊김) 시 rename 후 롤백만 되고 복구가 안 돌면 원본 고아 + 업로드 영구 404.
    let asset = tokio::spawn(store_asset(
        state, guard, upload, req, current, media, sha256,
    ))
    .await
    .context("finalize task")??;
    Ok((StatusCode::CREATED, AxumJson(asset)))
}

/// 자산 행·태그·작업 등록, 원본 이동, 커밋. 락 가드 소유로 끝날 때까지 다른 PATCH·finalize·삭제 차단.
async fn store_asset(
    state: AppState,
    _guard: OwnedMutexGuard<()>,
    upload: Upload,
    req: FinalizeRequest,
    current: CurrentUser,
    media: MediaType,
    sha256: [u8; 32],
) -> AppResult<Asset> {
    let id = upload.id;
    let user_id = current.user.id;
    let temp = storage::upload_temp_path(&state.config.data_dir, id);
    let asset_id = Uuid::now_v7();
    // 원본 경로 YYYY/MM 과 행 created_at 일치용. DB 기본값 대신 명시.
    let created_at = Utc::now();
    let rel_path = storage::original_rel_path(created_at, asset_id, media.ext());
    let (taken_at, taken_at_source) = match req.file_modified_at {
        Some(at) => (at, TakenAtSource::FileMtime),
        None => (created_at, TakenAtSource::UploadTime),
    };
    let new = NewAsset {
        id: asset_id,
        kind: media.kind(),
        uploaded_by: user_id,
        original_path: &rel_path.to_string_lossy(),
        original_filename: upload
            .metadata
            .get("filename")
            .and_then(Value::as_str)
            .unwrap_or_default(),
        mime: media.mime(),
        size_bytes: upload.length,
        sha256: &sha256,
        taken_at,
        taken_at_source,
        file_modified_at: req.file_modified_at,
        created_at,
    };

    let mut tx = state.pool.begin().await?;
    let mut replaced = None;
    if let Some(existing) = assets::queries::find_by_sha256(&mut *tx, &sha256).await? {
        if existing.status != AssetStatus::Failed {
            drop(tx);
            attach_existing(&state, &current, req.attach.as_ref(), existing.id).await?;
            discard_upload(&state, id).await?;
            return Err(duplicate(&existing));
        }
        // 그사이 재처리 등으로 상태가 바뀌었으면 삭제 안 됨 → 아래 INSERT 의 unique 위반으로 409.
        if assets::queries::delete_failed(&mut *tx, existing.id).await? {
            jobs::delete_for_asset(&mut *tx, existing.id).await?;
            replaced = Some(existing);
        }
    }
    match assets::queries::insert(&mut *tx, &new).await {
        // 같은 바이트의 동시 finalize. 먼저 커밋한 쪽 기준 409.
        Err(AppError::Db(sqlx::Error::Database(err)))
            if err.constraint() == Some("assets_sha256_key") =>
        {
            drop(tx);
            let existing = assets::queries::find_by_sha256(&state.pool, &sha256)
                .await?
                .context("duplicate asset vanished after unique violation")?;
            attach_existing(&state, &current, req.attach.as_ref(), existing.id).await?;
            discard_upload(&state, id).await?;
            return Err(duplicate(&existing));
        }
        other => other?,
    }
    assets::queries::add_babies(&mut *tx, asset_id, &req.baby_ids, user_id).await?;
    if let Some(target) = &req.attach {
        attach(&mut tx, &current, target, asset_id).await?;
    }
    jobs::enqueue(&mut *tx, &Job::ProcessAsset { asset_id }).await?;
    queries::delete(&mut *tx, id).await?;
    let asset = assets::queries::get(&mut *tx, asset_id, user_id)
        .await?
        .context("inserted asset missing")?;

    // 커밋 전 이동(같은 파일시스템 rename). 실패 시 롤백 + 원위치로 업로드 유지.
    let original = state.config.data_dir.join(&rel_path);
    let original_dir = original.parent().context("original path without parent")?;
    tokio::fs::create_dir_all(original_dir)
        .await
        .context("create original dir")?;
    // rename 은 mtime 보존. 이동 전 `.part` 갱신으로 원본이 처음부터 최신 상태로 노출(커밋 전 고아 정리 방지). 실패해도 진행.
    touch(&temp).await;
    tokio::fs::rename(&temp, &original)
        .await
        .context("move upload to original path")?;
    let committed: AppResult<()> = async {
        // 크래시 후 이동 유실 방지. 커밋 전 디렉터리 fsync.
        let dir = tokio::fs::File::open(original_dir)
            .await
            .context("open original dir")?;
        dir.sync_all().await.context("fsync original dir")?;
        Ok(tx.commit().await?)
    }
    .await;
    if let Err(err) = committed {
        // 응답 유실로 커밋이 실제 반영됐을 수 있음. 행이 없다고 확인될 때만 원위치(원본 보존 우선).
        let row_exists = sqlx::query_scalar!(
            r#"SELECT EXISTS(SELECT 1 FROM assets WHERE id = $1) AS "exists!""#,
            asset_id
        )
        .fetch_one(&state.pool)
        .await;
        match row_exists {
            Ok(false) => {
                if let Err(restore) = tokio::fs::rename(&original, &temp).await {
                    tracing::error!(
                        %restore, upload_id = %id, path = %original.display(),
                        "original restore after failed finalize failed"
                    );
                }
            }
            Ok(true) => tracing::warn!(
                upload_id = %id, %asset_id, "finalize commit reported failure but asset exists, original kept"
            ),
            Err(check) => tracing::warn!(
                %check, upload_id = %id, %asset_id, "asset existence check failed, original kept in place"
            ),
        }
        return Err(err);
    }
    state.jobs_wake.notify_one();
    if let Some(old) = replaced {
        remove_replaced_files(&state.config.data_dir, &old).await;
    }
    state.upload_locks.remove(id);
    Ok(asset)
}

/// 대상이 있고 요청자가 고칠 수 있으면 맨 뒤에 연결, 아니면 건너뜀.
/// 이야기는 작성자이고 guardian 이상, 마일스톤은 guardian 이상. 대상 행 잠금으로 동시 삭제 시 FK 위반 방지.
async fn attach(
    conn: &mut PgConnection,
    current: &CurrentUser,
    target: &AttachTarget,
    asset_id: Uuid,
) -> AppResult<()> {
    let allowed = match target.kind {
        LinkKind::Story => stories::queries::author_for_link(&mut *conn, target.id)
            .await?
            .is_some_and(|author| stories::can_edit(current, author)),
        LinkKind::Milestone => {
            current.require(Role::Guardian).is_ok()
                && milestones::queries::exists_for_link(&mut *conn, target.id).await?
        }
    };
    if allowed {
        links::append(&mut *conn, target.kind, target.id, asset_id).await?;
    }
    Ok(())
}

/// 중복 업로드의 기존 사진 연결. 휴지통이면 건너뜀. 연결 실패 시 업로드 유지(재시도 가능).
async fn attach_existing(
    state: &AppState,
    current: &CurrentUser,
    target: Option<&AttachTarget>,
    asset_id: Uuid,
) -> AppResult<()> {
    let Some(target) = target else {
        return Ok(());
    };
    let mut tx = state.pool.begin().await?;
    if links::lock_visible_assets(&mut *tx, &[asset_id]).await? == 1 {
        attach(&mut tx, current, target, asset_id).await?;
    }
    tx.commit().await?;
    Ok(())
}

/// mtime 을 현재로. 파일 소유자면 읽기 전용 fd 로 충분.
async fn touch(path: &FsPath) {
    let path = path.to_path_buf();
    let result = tokio::task::spawn_blocking(move || {
        std::fs::File::open(&path)?.set_modified(std::time::SystemTime::now())
    })
    .await;
    match result {
        Ok(Ok(())) => {}
        Ok(Err(err)) => tracing::warn!(%err, "upload mtime refresh failed"),
        Err(err) => tracing::warn!(%err, "upload mtime refresh task failed"),
    }
}

fn duplicate(existing: &ShaMatch) -> AppError {
    AppError::Conflict {
        key: "asset.duplicate",
        params: json!({
            "asset_id": existing.id,
            "in_trash": existing.deleted_at.is_some(),
        }),
    }
}

/// 임시 파일 길이와 앞 `SNIFF_LEN` 바이트. 파일 없으면 `None`.
async fn read_head(path: &FsPath) -> io::Result<Option<(u64, Vec<u8>)>> {
    let file = match tokio::fs::File::open(path).await {
        Ok(file) => file,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(err),
    };
    let len = file.metadata().await?.len();
    let mut head = Vec::new();
    file.take(SNIFF_LEN).read_to_end(&mut head).await?;
    Ok(Some((len, head)))
}

/// 락 보유 상태에서 호출. 파일 먼저 삭제(실패 시 행 유지로 재시도 가능) 후 행·락 항목.
async fn discard_upload(state: &AppState, id: Uuid) -> AppResult<()> {
    remove_temp_file(&state.config.data_dir, id)
        .await
        .context("remove upload temp file")?;
    queries::delete(&state.pool, id).await?;
    state.upload_locks.remove(id);
    Ok(())
}

/// 교체된 failed 자산의 원본·파생물. 행은 이미 삭제라 실패는 경고만.
async fn remove_replaced_files(data_dir: &FsPath, old: &ShaMatch) {
    let original = data_dir.join(&old.original_path);
    if let Err(err) = tokio::fs::remove_file(&original).await
        && err.kind() != io::ErrorKind::NotFound
    {
        tracing::warn!(%err, asset_id = %old.id, "replaced original removal failed");
    }
    let derivatives = storage::derivative_dir(data_dir, old.id);
    if let Err(err) = tokio::fs::remove_dir_all(&derivatives).await
        && err.kind() != io::ErrorKind::NotFound
    {
        tracing::warn!(%err, asset_id = %old.id, "replaced derivatives removal failed");
    }
}
