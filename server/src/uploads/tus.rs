//! tus 1.0.0 부분집합: core + creation, termination, expiration.

use std::{io, path::PathBuf, time::Duration};

use anyhow::Context;
use axum::{
    body::BodyDataStream,
    extract::{Request, State},
    http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use chrono::{DateTime, Utc};
use futures_util::StreamExt;
use serde_json::{Map, Value};
use tokio::{io::AsyncWriteExt, sync::OwnedMutexGuard};
use tower_http::set_header::SetResponseHeaderLayer;
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use super::{MAX_UPLOAD_BYTES, Upload, queries, remove_temp_file};
use crate::{
    auth::extract::CurrentUser,
    error::{AppError, AppResult, ErrorBody},
    media::storage,
    request::Path,
    state::AppState,
    users::Role,
};

const TUS_VERSION: HeaderValue = HeaderValue::from_static("1.0.0");
const TUS_RESUMABLE: HeaderName = HeaderName::from_static("tus-resumable");
const TUS_VERSION_HEADER: HeaderName = HeaderName::from_static("tus-version");
const TUS_EXTENSION: HeaderName = HeaderName::from_static("tus-extension");
const TUS_MAX_SIZE: HeaderName = HeaderName::from_static("tus-max-size");
const UPLOAD_LENGTH: HeaderName = HeaderName::from_static("upload-length");
const UPLOAD_OFFSET: HeaderName = HeaderName::from_static("upload-offset");
const UPLOAD_EXPIRES: HeaderName = HeaderName::from_static("upload-expires");
const UPLOAD_METADATA: HeaderName = HeaderName::from_static("upload-metadata");
const UPLOAD_DEFER_LENGTH: HeaderName = HeaderName::from_static("upload-defer-length");
const OFFSET_STREAM: &str = "application/offset+octet-stream";
const MAX_METADATA_BYTES: usize = 4096;
const MAX_METADATA_KEYS: usize = 16;

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(tus_options, create_upload))
        .routes(routes!(head_upload, patch_upload, delete_upload))
        .layer(middleware::from_fn(require_tus_version))
        .layer(SetResponseHeaderLayer::overriding(
            TUS_RESUMABLE,
            TUS_VERSION,
        ))
}

/// OPTIONS 외 요청은 `Tus-Resumable: 1.0.0` 필수.
async fn require_tus_version(req: Request, next: Next) -> Response {
    if req.method() == Method::OPTIONS || req.headers().get(TUS_RESUMABLE) == Some(&TUS_VERSION) {
        return next.run(req).await;
    }
    let mut res = AppError::PreconditionFailed("upload.tusVersion").into_response();
    res.headers_mut().insert(TUS_VERSION_HEADER, TUS_VERSION);
    res
}

/// RFC 7231 IMF-fixdate.
fn http_date(at: DateTime<Utc>) -> String {
    at.format("%a, %d %b %Y %H:%M:%S GMT").to_string()
}

fn header_u64(headers: &HeaderMap, name: &HeaderName) -> Option<u64> {
    headers.get(name)?.to_str().ok()?.parse().ok()
}

/// `key base64(value)` 쌍의 쉼표 목록. 값 생략 가능. 키 중복·비 UTF-8 값 거부.
fn parse_metadata(raw: Option<&HeaderValue>) -> AppResult<Map<String, Value>> {
    let invalid = || AppError::bad_request("upload.metadataInvalid");
    let mut map = Map::new();
    let Some(raw) = raw else {
        return Ok(map);
    };
    if raw.len() > MAX_METADATA_BYTES {
        return Err(invalid());
    }
    let raw = raw.to_str().map_err(|_| invalid())?;
    if raw.trim().is_empty() {
        return Ok(map);
    }
    for pair in raw.split(',') {
        let pair = pair.trim();
        let (key, encoded) = pair.split_once(' ').unwrap_or((pair, ""));
        if key.is_empty() || !key.bytes().all(|b| b.is_ascii_graphic()) {
            return Err(invalid());
        }
        let decoded = STANDARD.decode(encoded.trim()).map_err(|_| invalid())?;
        let value = String::from_utf8(decoded).map_err(|_| invalid())?;
        if map.insert(key.to_string(), Value::String(value)).is_some() {
            return Err(invalid());
        }
        if map.len() > MAX_METADATA_KEYS {
            return Err(invalid());
        }
    }
    Ok(map)
}

async fn find_upload(state: &AppState, id: Uuid, user_id: Uuid) -> AppResult<Upload> {
    queries::find_for_user(&state.pool, id, user_id)
        .await?
        .ok_or(AppError::NotFound("upload.notFound"))
}

/// 현재 offset. 임시 파일이 없으면 404.
async fn temp_len(path: &std::path::Path) -> AppResult<u64> {
    match tokio::fs::metadata(path).await {
        Ok(meta) => Ok(meta.len()),
        Err(err) if err.kind() == io::ErrorKind::NotFound => {
            Err(AppError::NotFound("upload.notFound"))
        }
        Err(err) => Err(anyhow::Error::from(err)
            .context("upload temp file metadata")
            .into()),
    }
}

#[utoipa::path(
    options,
    path = "/api/uploads",
    responses(
        (status = 204, description = "tus 지원 정보", headers(
            ("Tus-Version" = String, description = "`1.0.0`"),
            ("Tus-Extension" = String, description = "`creation,termination,expiration`"),
            ("Tus-Max-Size" = u64, description = "최대 업로드 바이트 (8 GiB)"),
        )),
    )
)]
async fn tus_options() -> impl IntoResponse {
    (
        StatusCode::NO_CONTENT,
        [
            (TUS_VERSION_HEADER, TUS_VERSION),
            (
                TUS_EXTENSION,
                HeaderValue::from_static("creation,termination,expiration"),
            ),
            (TUS_MAX_SIZE, HeaderValue::from(MAX_UPLOAD_BYTES)),
        ],
    )
}

#[utoipa::path(
    post,
    path = "/api/uploads",
    params(
        ("Tus-Resumable" = String, Header, description = "`1.0.0`"),
        ("Upload-Length" = u64, Header, description = "전체 바이트 수. 8 GiB 이하"),
        ("Upload-Metadata" = String, Header,
            description = "tus metadata. `filename` 필수. 4 KiB·16개 키 이하"),
    ),
    responses(
        (status = 201, description = "업로드 생성 (빈 임시 파일)", headers(
            ("Location" = String, description = "`/api/uploads/{id}` (상대 경로)"),
            ("Upload-Expires" = String, description = "만료 시각 (RFC 7231)"),
        )),
        (status = 400, description = "길이·metadata 오류 또는 `Upload-Defer-Length` 사용", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 403, description = "guardian 이상 아님 또는 CSRF 헤더 누락", body = ErrorBody),
        (status = 412, description = "`Tus-Resumable` 누락·불일치", body = ErrorBody),
        (status = 413, description = "최대 크기 초과", body = ErrorBody),
    )
)]
async fn create_upload(
    State(state): State<AppState>,
    current: CurrentUser,
    headers: HeaderMap,
) -> AppResult<Response> {
    current.require(Role::Guardian)?;
    if headers.contains_key(UPLOAD_DEFER_LENGTH) {
        return Err(AppError::bad_request("upload.deferNotSupported"));
    }
    let length = header_u64(&headers, &UPLOAD_LENGTH)
        .ok_or_else(|| AppError::bad_request("upload.lengthInvalid"))?;
    if length > MAX_UPLOAD_BYTES {
        return Err(AppError::PayloadTooLarge("upload.tooLarge"));
    }
    let metadata = parse_metadata(headers.get(UPLOAD_METADATA))?;
    if !metadata
        .get("filename")
        .and_then(Value::as_str)
        .is_some_and(|name| !name.trim().is_empty())
    {
        return Err(AppError::bad_request("upload.filenameRequired"));
    }

    // 행은 빈 임시 파일 생성 성공 후 커밋.
    let mut tx = state.pool.begin().await?;
    let upload = queries::create(
        &mut *tx,
        current.user.id,
        length as i64,
        &Value::Object(metadata),
    )
    .await?;
    let path = storage::upload_temp_path(&state.config.data_dir, upload.id);
    tokio::fs::File::create(&path)
        .await
        .context("create upload temp file")?;
    if let Err(err) = tx.commit().await {
        let _ = tokio::fs::remove_file(&path).await;
        return Err(err.into());
    }

    Ok((
        StatusCode::CREATED,
        [
            (header::LOCATION, format!("/api/uploads/{}", upload.id)),
            (UPLOAD_EXPIRES, http_date(upload.expires_at)),
        ],
    )
        .into_response())
}

#[utoipa::path(
    head,
    path = "/api/uploads/{id}",
    params(
        ("id" = Uuid, Path, description = "업로드 ID"),
        ("Tus-Resumable" = String, Header, description = "`1.0.0`"),
    ),
    responses(
        (status = 200, description = "업로드 진행 상태", headers(
            ("Upload-Offset" = u64, description = "받은 바이트 수"),
            ("Upload-Length" = u64, description = "전체 바이트 수"),
            ("Upload-Expires" = String, description = "만료 시각 (RFC 7231)"),
            ("Cache-Control" = String, description = "`no-store`"),
        )),
        (status = 400, description = "잘못된 ID 형식", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 404, description = "업로드 없음·만료·다른 사용자 소유", body = ErrorBody),
        (status = 412, description = "`Tus-Resumable` 누락·불일치", body = ErrorBody),
    )
)]
async fn head_upload(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(id): Path<Uuid>,
) -> AppResult<Response> {
    let upload = find_upload(&state, id, current.user.id).await?;
    let offset = temp_len(&storage::upload_temp_path(&state.config.data_dir, id)).await?;
    Ok((
        StatusCode::OK,
        [
            (UPLOAD_OFFSET, offset.to_string()),
            (UPLOAD_LENGTH, upload.length.to_string()),
            (UPLOAD_EXPIRES, http_date(upload.expires_at)),
            (header::CACHE_CONTROL, "no-store".to_string()),
        ],
    )
        .into_response())
}

enum Appended {
    Bytes(u64),
    /// 남은 길이 초과. 이번 PATCH 분은 되돌림.
    Overflow,
}

/// 분리 태스크에서 실행. 핸들러가 연결 끊김으로 취소돼도 받은 바이트까지 기록·fsync.
/// 락 가드 소유로 쓰기 끝날 때까지 다른 PATCH·finalize 차단.
async fn append_body(
    _guard: OwnedMutexGuard<()>,
    path: PathBuf,
    start: u64,
    remaining: u64,
    mut body: BodyDataStream,
    idle_timeout: Duration,
) -> io::Result<Appended> {
    let mut file = tokio::fs::OpenOptions::new()
        .append(true)
        .open(&path)
        .await?;
    let mut written = 0u64;
    let mut overflow = false;
    loop {
        // 본문 끝·본문 오류(연결 끊김)·무수신 시간 초과 모두 종료. 받은 데까지 보존.
        let Ok(Some(Ok(chunk))) = tokio::time::timeout(idle_timeout, body.next()).await else {
            break;
        };
        if chunk.len() as u64 > remaining - written {
            overflow = true;
            break;
        }
        file.write_all(&chunk).await?;
        written += chunk.len() as u64;
    }
    file.flush().await?;
    if overflow {
        file.set_len(start).await?;
    }
    file.sync_data().await?;
    Ok(if overflow {
        Appended::Overflow
    } else {
        Appended::Bytes(written)
    })
}

#[utoipa::path(
    patch,
    path = "/api/uploads/{id}",
    params(
        ("id" = Uuid, Path, description = "업로드 ID"),
        ("Tus-Resumable" = String, Header, description = "`1.0.0`"),
        ("Upload-Offset" = u64, Header, description = "현재 offset (HEAD 값)"),
    ),
    request_body(content = Vec<u8>, content_type = "application/offset+octet-stream",
        description = "offset 부터 이어 붙일 바이트"),
    responses(
        (status = 204, description = "기록 완료. 만료 24시간 연장", headers(
            ("Upload-Offset" = u64, description = "새 offset"),
            ("Upload-Expires" = String, description = "만료 시각 (RFC 7231)"),
        )),
        (status = 400, description = "`Upload-Offset` 형식 오류 또는 잘못된 ID 형식", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 403, description = "CSRF 헤더 누락", body = ErrorBody),
        (status = 404, description = "업로드 없음·만료·다른 사용자 소유", body = ErrorBody),
        (status = 409, description = "offset 불일치(`upload.offsetMismatch`) 또는 다른 PATCH·finalize 진행 중(`upload.locked`)", body = ErrorBody),
        (status = 412, description = "`Tus-Resumable` 누락·불일치", body = ErrorBody),
        (status = 413, description = "본문이 남은 길이 초과", body = ErrorBody),
        (status = 415, description = "`Content-Type` 이 `application/offset+octet-stream` 아님", body = ErrorBody),
    )
)]
async fn patch_upload(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(id): Path<Uuid>,
    req: Request,
) -> AppResult<Response> {
    let headers = req.headers();
    if headers.get(header::CONTENT_TYPE).map(HeaderValue::as_bytes)
        != Some(OFFSET_STREAM.as_bytes())
    {
        return Err(AppError::UnsupportedMediaType("upload.contentType"));
    }
    let client_offset = header_u64(headers, &UPLOAD_OFFSET)
        .ok_or_else(|| AppError::bad_request("upload.offsetInvalid"))?;
    let content_length = header_u64(headers, &header::CONTENT_LENGTH);

    let upload = find_upload(&state, id, current.user.id).await?;
    let guard = state
        .upload_locks
        .try_acquire(id)
        .ok_or_else(|| AppError::conflict("upload.locked"))?;
    let path = storage::upload_temp_path(&state.config.data_dir, id);
    let offset = match temp_len(&path).await {
        Ok(offset) => offset,
        Err(err) => {
            // 조회 후 락 획득 전에 삭제·finalize 된 경우. 새로 생긴 락 항목 정리.
            if matches!(err, AppError::NotFound(_)) {
                state.upload_locks.remove(id);
            }
            return Err(err);
        }
    };
    if client_offset != offset {
        return Err(AppError::conflict("upload.offsetMismatch"));
    }
    let remaining = u64::try_from(upload.length)
        .unwrap_or(0)
        .saturating_sub(offset);
    if content_length.is_some_and(|len| len > remaining) {
        return Err(AppError::PayloadTooLarge("upload.tooLarge"));
    }

    let body = req.into_body().into_data_stream();
    let appended = tokio::spawn(append_body(
        guard,
        path,
        offset,
        remaining,
        body,
        state.upload_idle_timeout,
    ))
    .await
    .context("upload write task")?
    .context("append upload chunk")?;
    let written = match appended {
        Appended::Bytes(written) => written,
        Appended::Overflow => return Err(AppError::PayloadTooLarge("upload.tooLarge")),
    };
    let expires_at = queries::extend_expiry(&state.pool, id).await?;
    Ok((
        StatusCode::NO_CONTENT,
        [
            (UPLOAD_OFFSET, (offset + written).to_string()),
            (UPLOAD_EXPIRES, http_date(expires_at)),
        ],
    )
        .into_response())
}

#[utoipa::path(
    delete,
    path = "/api/uploads/{id}",
    params(
        ("id" = Uuid, Path, description = "업로드 ID"),
        ("Tus-Resumable" = String, Header, description = "`1.0.0`"),
    ),
    responses(
        (status = 204, description = "업로드 중단. 행·임시 파일 삭제"),
        (status = 400, description = "잘못된 ID 형식", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 403, description = "CSRF 헤더 누락", body = ErrorBody),
        (status = 404, description = "업로드 없음·만료·다른 사용자 소유", body = ErrorBody),
        (status = 409, description = "PATCH·finalize 진행 중", body = ErrorBody),
        (status = 412, description = "`Tus-Resumable` 누락·불일치", body = ErrorBody),
    )
)]
async fn delete_upload(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    find_upload(&state, id, current.user.id).await?;
    let _guard = state
        .upload_locks
        .try_acquire(id)
        .ok_or_else(|| AppError::conflict("upload.locked"))?;
    // 파일 먼저. 실패 시 행 유지로 재시도 가능.
    remove_temp_file(&state.config.data_dir, id)
        .await
        .context("remove upload temp file")?;
    queries::delete(&state.pool, id).await?;
    state.upload_locks.remove(id);
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;

    use super::*;

    fn meta(raw: &str) -> AppResult<Map<String, Value>> {
        parse_metadata(Some(&HeaderValue::from_str(raw).unwrap()))
    }

    #[test]
    fn metadata_parsing() {
        let map = meta("filename 7JWE6riwLmhlaWM=, filetype aW1hZ2UvaGVpYw==,flag").unwrap();
        assert_eq!(map["filename"], "아기.heic");
        assert_eq!(map["filetype"], "image/heic");
        assert_eq!(map["flag"], "");
        assert!(parse_metadata(None).unwrap().is_empty());

        for bad in [
            "filename !!!",
            "filename YQ==,filename Yg==",
            "a b c",
            "filename YQ==,,",
            "bin /w==",
        ] {
            assert!(meta(bad).is_err(), "{bad}");
        }
        let many = (0..17)
            .map(|i| format!("k{i}"))
            .collect::<Vec<_>>()
            .join(",");
        assert!(meta(&many).is_err());
        let long = format!("filename {}", "A".repeat(MAX_METADATA_BYTES));
        assert!(meta(&long).is_err());
    }

    #[test]
    fn http_date_is_imf_fixdate() {
        let at = Utc.with_ymd_and_hms(2026, 11, 7, 3, 4, 5).unwrap();
        assert_eq!(http_date(at), "Sat, 07 Nov 2026 03:04:05 GMT");
    }
}
