use axum::{Json, extract::State, http::StatusCode};
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use super::{
    Comment, CommentRequest, ListQuery, check_can_delete, check_can_edit, check_limit, into_page,
    queries, validate,
};
use crate::{
    assets::{Page, cursor},
    auth::extract::CurrentUser,
    error::{AppError, AppResult, ErrorBody},
    reactions::require_visible,
    request::{Json as JsonBody, Path, Query},
    state::AppState,
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(list_comments, create_comment))
        .routes(routes!(update_comment, delete_comment))
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
    let limit = check_limit(q.limit)?;
    let after = q.cursor.as_deref().map(cursor::decode).transpose()?;
    require_visible(&state.pool, id).await?;
    let items = queries::list(&state.pool, id, after, limit + 1).await?;
    Ok(Json(into_page(items, limit, |c| (c.created_at, c.id))))
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
    check_can_edit(&current, author)?;
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
    check_can_delete(&current, author)?;
    if !queries::delete(&state.pool, id).await? {
        return Err(AppError::NotFound("comment.notFound"));
    }
    Ok(StatusCode::NO_CONTENT)
}
