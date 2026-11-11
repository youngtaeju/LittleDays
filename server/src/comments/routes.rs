use axum::{Json, extract::State, http::StatusCode};
use serde::Deserialize;
use sqlx::PgExecutor;
use utoipa::{IntoParams, ToSchema};
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use super::{Comment, mention_ids, normalize_body, queries};
use crate::{
    assets::{Page, cursor},
    auth::extract::CurrentUser,
    error::{AppError, AppResult, ErrorBody},
    reactions::require_visible,
    request::{Json as JsonBody, Path, Query},
    state::AppState,
    users::Role,
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(list_comments, create_comment))
        .routes(routes!(update_comment, delete_comment))
}

const DEFAULT_LIMIT: i64 = 100;
const MAX_LIMIT: i64 = 100;

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
struct ListQuery {
    /// 이전 응답의 `next_cursor`.
    cursor: Option<String>,
    /// 1~100, 기본 100.
    limit: Option<i64>,
}

#[derive(Deserialize, ToSchema)]
struct CommentRequest {
    /// 앞뒤 공백 제거 후 1~1000자. 멘션은 `<@사용자id>`.
    body: String,
}

/// 본문 검증과 멘션 대상 존재 확인. 저장할 본문 반환.
async fn validate<'a>(exec: impl PgExecutor<'_>, raw: &'a str) -> AppResult<&'a str> {
    let body = normalize_body(raw)?;
    let ids = mention_ids(body);
    if !ids.is_empty() && queries::count_users(exec, &ids).await? != ids.len() as i64 {
        return Err(AppError::bad_request("comment.mentionInvalid"));
    }
    Ok(body)
}

#[utoipa::path(
    get,
    path = "/api/assets/{id}/comments",
    params(("id" = Uuid, Path, description = "자산 ID"), ListQuery),
    responses(
        (status = 200, description = "오래된 순 댓글", body = Page<Comment>),
        (status = 400, description = "쿼리 오류 (`request.invalidQuery`, `asset.invalidCursor`)", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 404, description = "자산 없음 또는 휴지통 (`asset.notFound`)", body = ErrorBody),
    )
)]
async fn list_comments(
    State(state): State<AppState>,
    _current: CurrentUser,
    Path(id): Path<Uuid>,
    Query(q): Query<ListQuery>,
) -> AppResult<Json<Page<Comment>>> {
    let limit = q.limit.unwrap_or(DEFAULT_LIMIT);
    if !(1..=MAX_LIMIT).contains(&limit) {
        return Err(AppError::bad_request("request.invalidQuery"));
    }
    let after = q.cursor.as_deref().map(cursor::decode).transpose()?;
    require_visible(&state.pool, id).await?;
    let mut items = queries::list(&state.pool, id, after, limit + 1).await?;
    let next_cursor = if items.len() as i64 > limit {
        items.truncate(limit as usize);
        items.last().map(|c| cursor::encode(c.created_at, c.id))
    } else {
        None
    };
    Ok(Json(Page { items, next_cursor }))
}

#[utoipa::path(
    post,
    path = "/api/assets/{id}/comments",
    params(("id" = Uuid, Path, description = "자산 ID")),
    request_body = CommentRequest,
    responses(
        (status = 201, description = "작성됨", body = Comment),
        (status = 400, description = "본문 오류 (`comment.bodyInvalid`, `comment.mentionInvalid`)", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 403, description = "CSRF 헤더 누락", body = ErrorBody),
        (status = 404, description = "자산 없음 또는 휴지통 (`asset.notFound`)", body = ErrorBody),
    )
)]
async fn create_comment(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(id): Path<Uuid>,
    JsonBody(req): JsonBody<CommentRequest>,
) -> AppResult<(StatusCode, Json<Comment>)> {
    let mut tx = state.pool.begin().await?;
    require_visible(&mut *tx, id).await?;
    let body = validate(&mut *tx, &req.body).await?;
    let comment = queries::insert(&mut *tx, id, current.user.id, body).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(comment)))
}

#[utoipa::path(
    patch,
    path = "/api/comments/{id}",
    params(("id" = Uuid, Path, description = "댓글 ID")),
    request_body = CommentRequest,
    responses(
        (status = 200, description = "고쳐짐", body = Comment),
        (status = 400, description = "본문 오류 (`comment.bodyInvalid`, `comment.mentionInvalid`)", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 403, description = "작성자 아님 (`comment.forbidden`) 또는 CSRF 헤더 누락", body = ErrorBody),
        (status = 404, description = "댓글 없음 또는 사진이 휴지통 (`comment.notFound`)", body = ErrorBody),
    )
)]
async fn update_comment(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(id): Path<Uuid>,
    JsonBody(req): JsonBody<CommentRequest>,
) -> AppResult<Json<Comment>> {
    let author = queries::visible_author(&state.pool, id)
        .await?
        .ok_or(AppError::NotFound("comment.notFound"))?;
    if author != current.user.id {
        return Err(AppError::Forbidden("comment.forbidden"));
    }
    let body = validate(&state.pool, &req.body).await?;
    queries::update_body(&state.pool, id, body)
        .await?
        .map(Json)
        .ok_or(AppError::NotFound("comment.notFound"))
}

#[utoipa::path(
    delete,
    path = "/api/comments/{id}",
    params(("id" = Uuid, Path, description = "댓글 ID")),
    responses(
        (status = 204, description = "지워짐"),
        (status = 400, description = "ID 형식 오류 (`request.invalidPath`)", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 403, description = "작성자나 owner, guardian 아님 (`comment.forbidden`) 또는 CSRF 헤더 누락", body = ErrorBody),
        (status = 404, description = "댓글 없음 또는 사진이 휴지통 (`comment.notFound`)", body = ErrorBody),
    )
)]
async fn delete_comment(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let author = queries::visible_author(&state.pool, id)
        .await?
        .ok_or(AppError::NotFound("comment.notFound"))?;
    let moderator = matches!(current.user.role, Role::Owner | Role::Guardian);
    if author != current.user.id && !moderator {
        return Err(AppError::Forbidden("comment.forbidden"));
    }
    if !queries::delete(&state.pool, id).await? {
        return Err(AppError::NotFound("comment.notFound"));
    }
    Ok(StatusCode::NO_CONTENT)
}
