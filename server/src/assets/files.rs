use std::path::PathBuf;

use axum::{
    extract::{Request, State},
    handler::Handler,
    http::{HeaderValue, StatusCode, header},
    response::Response,
    routing::get_service,
};
use tower_http::services::ServeFile;
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use super::{AssetKind, AssetStatus, queries, queries::FileInfo};
use crate::{
    auth::extract::{MediaQuery, MediaUser},
    error::{AppError, AppResult, ErrorBody},
    media::storage,
    openapi::BinaryBody,
    request::Path,
    state::AppState,
    users::Role,
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(get_original))
        .routes(routes!(get_video))
        .routes(routes!(get_file))
}

const CACHE_CONTROL: HeaderValue = HeaderValue::from_static("private, max-age=86400");
// 처리 중·실패 자산은 원본 대체 응답이 캐시되지 않게.
const NO_STORE: HeaderValue = HeaderValue::from_static("no-store");

/// 허용 파생물 파일. `<variant>.<format>`.
const FILES: &[(&str, &str, &str)] = &[
    ("thumb.webp", "thumb", "webp"),
    ("preview.webp", "preview", "webp"),
    ("preview.avif", "preview", "avif"),
    ("large.webp", "large", "webp"),
    ("playback.mp4", "playback", "mp4"),
];

async fn load(state: &AppState, user: &MediaUser, id: Uuid) -> AppResult<FileInfo> {
    queries::file_info(&state.pool, id)
        .await?
        .filter(|a| {
            a.deleted_at.is_none() || matches!(user.user.role, Role::Owner | Role::Guardian)
        })
        .ok_or(AppError::NotFound("asset.notFound"))
}

fn has_format(derivatives: &serde_json::Value, variant: &str, format: &str) -> bool {
    derivatives
        .get(variant)
        .and_then(|v| v.get("formats"))
        .and_then(|f| f.as_array())
        .is_some_and(|f| f.iter().any(|x| x.as_str() == Some(format)))
}

/// `ServeFile` 위임 후 헤더 보정. 없는 파일은 표준 404.
async fn serve(
    path: PathBuf,
    req: Request,
    content_type: Option<&str>,
    disposition: Option<HeaderValue>,
    ready: bool,
) -> AppResult<Response> {
    let mut res = Handler::call(get_service(ServeFile::new(path)), req, ()).await;
    if res.status() == StatusCode::NOT_FOUND {
        return Err(AppError::NotFound("asset.fileNotFound"));
    }
    let status = res.status();
    let headers = res.headers_mut();
    if status.is_success() || status == StatusCode::NOT_MODIFIED {
        headers.insert(
            header::CACHE_CONTROL,
            if ready { CACHE_CONTROL } else { NO_STORE },
        );
    }
    if status.is_success() {
        if let Some(ct) = content_type.and_then(|c| HeaderValue::from_str(c).ok()) {
            headers.insert(header::CONTENT_TYPE, ct);
        }
        if let Some(d) = disposition {
            headers.insert(header::CONTENT_DISPOSITION, d);
        }
    }
    Ok(res)
}

/// RFC 5987 `attr-char` 외 바이트 퍼센트 인코딩.
fn percent_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"!#$&+-.^_`|~".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// 비 ASCII, 제어문자, `"`, `\`, `/` 는 `_`.
fn ascii_fallback(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_ascii() && !c.is_ascii_control() && !matches!(c, '"' | '\\' | '/') {
                c
            } else {
                '_'
            }
        })
        .collect()
}

/// 이름이 비면 `<asset id>.<확장자>`.
fn disposition(id: Uuid, filename: &str, original_path: &str) -> Option<HeaderValue> {
    let trimmed = filename.trim();
    let name = if trimmed.is_empty() {
        let ext = std::path::Path::new(original_path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("bin");
        format!("{id}.{ext}")
    } else {
        trimmed.to_string()
    };
    let value = format!(
        "attachment; filename=\"{}\"; filename*=UTF-8''{}",
        ascii_fallback(&name),
        percent_encode(&name)
    );
    HeaderValue::from_str(&value).ok()
}

#[utoipa::path(
    get,
    path = "/api/assets/{id}/original",
    params(("id" = Uuid, Path, description = "자산 ID"), MediaQuery),
    responses(
        (status = 200, description = "원본 파일 (`attachment`, Range·조건부 요청 지원)", content_type = "application/octet-stream", body = BinaryBody),
        (status = 206, description = "Range 응답", content_type = "application/octet-stream", body = BinaryBody),
        (status = 304, description = "조건부 요청, 변경 없음"),
        (status = 400, description = "ID 형식 오류", body = ErrorBody),
        (status = 401, description = "인증 필요 또는 정지 계정 (`auth.required`, `auth.disabled`)", body = ErrorBody),
        (status = 404, description = "자산 없음, family 에게 휴지통 자산 (`asset.notFound`), 파일 없음 (`asset.fileNotFound`)", body = ErrorBody),
    )
)]
async fn get_original(
    State(state): State<AppState>,
    user: MediaUser,
    Path(id): Path<Uuid>,
    req: Request,
) -> AppResult<Response> {
    let asset = load(&state, &user, id).await?;
    let ready = asset.status == AssetStatus::Ready;
    let path = state.config.data_dir.join(&asset.original_path);
    let d = disposition(id, &asset.original_filename, &asset.original_path);
    serve(path, req, Some(&asset.mime), d, ready).await
}

#[utoipa::path(
    get,
    path = "/api/assets/{id}/video",
    params(("id" = Uuid, Path, description = "자산 ID"), MediaQuery),
    responses(
        (status = 200, description = "재생본, 없으면 원본 (inline, Range·조건부 요청 지원)", content_type = "video/mp4", body = BinaryBody),
        (status = 206, description = "Range 응답", content_type = "video/mp4", body = BinaryBody),
        (status = 304, description = "조건부 요청, 변경 없음"),
        (status = 400, description = "ID 형식 오류", body = ErrorBody),
        (status = 401, description = "인증 필요 또는 정지 계정 (`auth.required`, `auth.disabled`)", body = ErrorBody),
        (status = 404, description = "자산 없음, family 에게 휴지통 자산 (`asset.notFound`), 사진이거나 파일 없음 (`asset.fileNotFound`)", body = ErrorBody),
    )
)]
async fn get_video(
    State(state): State<AppState>,
    user: MediaUser,
    Path(id): Path<Uuid>,
    req: Request,
) -> AppResult<Response> {
    let asset = load(&state, &user, id).await?;
    let ready = asset.status == AssetStatus::Ready;
    if asset.kind != AssetKind::Video {
        return Err(AppError::NotFound("asset.fileNotFound"));
    }
    if has_format(&asset.derivatives, "playback", "mp4") {
        let path = storage::derivative_dir(&state.config.data_dir, id).join("playback.mp4");
        serve(path, req, Some("video/mp4"), None, ready).await
    } else {
        let path = state.config.data_dir.join(&asset.original_path);
        serve(path, req, Some(&asset.mime), None, ready).await
    }
}

#[utoipa::path(
    get,
    path = "/api/assets/{id}/{file}",
    params(
        ("id" = Uuid, Path, description = "자산 ID"),
        ("file" = String, Path, description = "`thumb.webp`, `preview.webp`, `preview.avif`, `large.webp`, `playback.mp4`"),
        MediaQuery,
    ),
    responses(
        (status = 200, description = "파생물 파일 (Range·조건부 요청 지원)", content_type = "image/webp", body = BinaryBody),
        (status = 206, description = "Range 응답", content_type = "image/webp", body = BinaryBody),
        (status = 304, description = "조건부 요청, 변경 없음"),
        (status = 400, description = "ID 형식 오류", body = ErrorBody),
        (status = 401, description = "인증 필요 또는 정지 계정 (`auth.required`, `auth.disabled`)", body = ErrorBody),
        (status = 404, description = "자산 없음, family 에게 휴지통 자산 (`asset.notFound`), 허용 외 이름이거나 해당 파생물 없음 (`asset.fileNotFound`)", body = ErrorBody),
    )
)]
async fn get_file(
    State(state): State<AppState>,
    user: MediaUser,
    Path((id, file)): Path<(Uuid, String)>,
    req: Request,
) -> AppResult<Response> {
    let asset = load(&state, &user, id).await?;
    let ready = asset.status == AssetStatus::Ready;
    let not_found = AppError::NotFound("asset.fileNotFound");
    let &(name, variant, format) = FILES.iter().find(|(n, ..)| *n == file).ok_or(not_found)?;
    if !has_format(&asset.derivatives, variant, format) {
        return Err(AppError::NotFound("asset.fileNotFound"));
    }
    let path = storage::derivative_dir(&state.config.data_dir, id).join(name);
    serve(path, req, None, None, ready).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filename_encoding() {
        assert_eq!(ascii_fallback("a\"b\\c/d\r\ne.jpg"), "a_b_c_d__e.jpg");
        assert_eq!(percent_encode("a b.jpg"), "a%20b.jpg");
        assert_eq!(percent_encode("가"), "%EA%B0%80");
    }

    #[test]
    fn disposition_never_fails() {
        let id = Uuid::nil();
        for name in ["", "  ", "\u{0}\r\n", "😀\"'*%"] {
            assert!(disposition(id, name, "originals/x.heic").is_some());
        }
        let v = disposition(id, " ", "originals/x.heic").unwrap();
        assert!(v.to_str().unwrap().contains(&format!("{id}.heic")));
    }
}
