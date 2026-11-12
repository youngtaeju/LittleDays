use axum::{Json, extract::State, http::StatusCode};
use chrono::NaiveDate;
use serde::Deserialize;
use sqlx::PgConnection;
use utoipa::ToSchema;
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use super::{Like, Story, StoryComment, can_edit, can_write, normalize_body, queries};
use crate::{
    assets::{Page, cursor},
    auth::extract::CurrentUser,
    babies,
    comments::{
        CommentRequest, ListQuery, check_can_delete, check_can_edit, check_limit, check_mentions,
        into_page, validate,
    },
    error::{AppError, AppResult, ErrorBody},
    links::{self, LinkKind, dedup},
    records,
    request::{Json as JsonBody, Path, Query},
    settings,
    state::AppState,
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(create_story))
        .routes(routes!(get_story, update_story, delete_story))
        .routes(routes!(like_story, unlike_story))
        .routes(routes!(list_story_likes))
        .routes(routes!(list_story_comments, create_story_comment))
        .routes(routes!(update_story_comment, delete_story_comment))
}

#[derive(Deserialize, ToSchema)]
struct CreateStoryRequest {
    /// 인스턴스 시간대 오늘 이전(오늘 포함).
    entry_date: NaiveDate,
    /// 앞뒤 공백 제거 후 1~5000자. 멘션은 `<@사용자id>`.
    body: String,
    /// 중복은 한 번만.
    baby_ids: Vec<Uuid>,
    /// 붙일 순서. 휴지통 아닌 사진만, 중복은 한 번만.
    asset_ids: Vec<Uuid>,
}

/// 보낸 필드만 교체.
#[derive(Deserialize, ToSchema)]
struct UpdateStoryRequest {
    entry_date: Option<NaiveDate>,
    body: Option<String>,
    /// 전체 교체.
    baby_ids: Option<Vec<Uuid>>,
    /// 전체 교체, 목록 순서가 붙일 순서.
    asset_ids: Option<Vec<Uuid>>,
}

async fn check_date(conn: &mut PgConnection, timezone: &str, date: NaiveDate) -> AppResult<()> {
    if !records::not_future(conn, timezone, date).await? {
        return Err(AppError::bad_request("story.dateInvalid"));
    }
    Ok(())
}

/// 중복 제거한 아기 목록. 모르는 아기면 400 `asset.babyInvalid`.
async fn check_babies(conn: &mut PgConnection, ids: &[Uuid]) -> AppResult<Vec<Uuid>> {
    let ids = dedup(ids);
    if !ids.is_empty() {
        let known = babies::queries::all_ids(conn).await?;
        if ids.iter().any(|b| !known.contains(b)) {
            return Err(AppError::bad_request("asset.babyInvalid"));
        }
    }
    Ok(ids)
}

#[utoipa::path(
    post,
    path = "/api/stories",
    request_body = CreateStoryRequest,
    responses(
        (status = 201, description = "작성됨", body = Story),
        (status = 400, description = "본문, 날짜, 아기 오류 (`story.bodyInvalid`, `comment.mentionInvalid`, `story.dateInvalid`, `asset.babyInvalid`, 사진 200장 초과 `request.invalidBody`)", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 403, description = "guardian 이상 아님 (`story.forbidden`) 또는 CSRF 헤더 누락", body = ErrorBody),
        (status = 404, description = "사진 없음 또는 휴지통 (`asset.notFound`)", body = ErrorBody),
    )
)]
async fn create_story(
    State(state): State<AppState>,
    current: CurrentUser,
    JsonBody(req): JsonBody<CreateStoryRequest>,
) -> AppResult<(StatusCode, Json<Story>)> {
    if !can_write(&current) {
        return Err(AppError::Forbidden("story.forbidden"));
    }
    let body = normalize_body(&req.body)?;
    let mut tx = state.pool.begin().await?;
    let timezone = settings::queries::load(&mut *tx).await?.timezone;
    check_mentions(&mut *tx, body).await?;
    check_date(&mut tx, &timezone, req.entry_date).await?;
    let baby_ids = check_babies(&mut tx, &req.baby_ids).await?;
    let asset_ids = links::check_assets(&mut tx, &req.asset_ids).await?;

    let id = Uuid::now_v7();
    queries::insert(&mut *tx, id, current.user.id, req.entry_date, body).await?;
    queries::replace_babies(&mut tx, id, &baby_ids).await?;
    links::replace_assets(&mut tx, LinkKind::Story, id, &asset_ids).await?;
    let story = queries::get(&mut tx, &timezone, id, current.user.id)
        .await?
        .ok_or(AppError::NotFound("story.notFound"))?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(story)))
}

#[utoipa::path(
    get,
    path = "/api/stories/{id}",
    params(("id" = Uuid, Path, description = "이야기 ID")),
    responses(
        (status = 200, description = "이야기 상세", body = Story),
        (status = 400, description = "ID 형식 오류", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 404, description = "이야기 없음 (`story.notFound`)", body = ErrorBody),
    )
)]
async fn get_story(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Story>> {
    let mut conn = state.pool.acquire().await?;
    let timezone = settings::queries::load(&mut *conn).await?.timezone;
    queries::get(&mut conn, &timezone, id, current.user.id)
        .await?
        .map(Json)
        .ok_or(AppError::NotFound("story.notFound"))
}

#[utoipa::path(
    patch,
    path = "/api/stories/{id}",
    params(("id" = Uuid, Path, description = "이야기 ID")),
    request_body = UpdateStoryRequest,
    responses(
        (status = 200, description = "고쳐짐. `edited_at` 갱신", body = Story),
        (status = 400, description = "본문, 날짜, 아기 오류 (`story.bodyInvalid`, `comment.mentionInvalid`, `story.dateInvalid`, `asset.babyInvalid`, 사진 200장 초과 `request.invalidBody`)", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 403, description = "guardian 이상 작성자 아님 (`story.forbidden`) 또는 CSRF 헤더 누락", body = ErrorBody),
        (status = 404, description = "이야기 없음 (`story.notFound`), 사진 없음 또는 휴지통 (`asset.notFound`)", body = ErrorBody),
    )
)]
async fn update_story(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(id): Path<Uuid>,
    JsonBody(req): JsonBody<UpdateStoryRequest>,
) -> AppResult<Json<Story>> {
    let mut tx = state.pool.begin().await?;
    let author = queries::lock_author(&mut *tx, id, false)
        .await?
        .ok_or(AppError::NotFound("story.notFound"))?;
    if !can_edit(&current, author) {
        return Err(AppError::Forbidden("story.forbidden"));
    }
    let body = req.body.as_deref().map(normalize_body).transpose()?;
    let timezone = settings::queries::load(&mut *tx).await?.timezone;
    if let Some(body) = body {
        check_mentions(&mut *tx, body).await?;
    }
    if let Some(date) = req.entry_date {
        check_date(&mut tx, &timezone, date).await?;
    }
    if let Some(ids) = &req.baby_ids {
        let ids = check_babies(&mut tx, ids).await?;
        queries::replace_babies(&mut tx, id, &ids).await?;
    }
    if let Some(ids) = &req.asset_ids {
        let ids = links::check_assets(&mut tx, ids).await?;
        links::replace_assets(&mut tx, LinkKind::Story, id, &ids).await?;
    }
    queries::update(&mut *tx, id, req.entry_date, body).await?;
    let story = queries::get(&mut tx, &timezone, id, current.user.id)
        .await?
        .ok_or(AppError::NotFound("story.notFound"))?;
    tx.commit().await?;
    Ok(Json(story))
}

#[utoipa::path(
    delete,
    path = "/api/stories/{id}",
    params(("id" = Uuid, Path, description = "이야기 ID")),
    responses(
        (status = 204, description = "지워짐. 붙인 사진은 남음"),
        (status = 400, description = "ID 형식 오류", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 403, description = "작성자나 owner, guardian 아님 (`story.forbidden`) 또는 CSRF 헤더 누락", body = ErrorBody),
        (status = 404, description = "이야기 없음 (`story.notFound`)", body = ErrorBody),
    )
)]
async fn delete_story(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let mut tx = state.pool.begin().await?;
    let author = queries::lock_author(&mut *tx, id, true)
        .await?
        .ok_or(AppError::NotFound("story.notFound"))?;
    if author != current.user.id && !can_write(&current) {
        return Err(AppError::Forbidden("story.forbidden"));
    }
    queries::delete(&mut *tx, id).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    put,
    path = "/api/stories/{id}/like",
    params(("id" = Uuid, Path, description = "이야기 ID")),
    responses(
        (status = 204, description = "하트 켬. 이미 켠 상태면 그대로"),
        (status = 400, description = "ID 형식 오류", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 403, description = "CSRF 헤더 누락", body = ErrorBody),
        (status = 404, description = "이야기 없음 (`story.notFound`)", body = ErrorBody),
    )
)]
async fn like_story(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let mut tx = state.pool.begin().await?;
    queries::require_exists(&mut *tx, id).await?;
    queries::like(&mut *tx, id, current.user.id).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    delete,
    path = "/api/stories/{id}/like",
    params(("id" = Uuid, Path, description = "이야기 ID")),
    responses(
        (status = 204, description = "하트 끔. 이미 끈 상태면 그대로"),
        (status = 400, description = "ID 형식 오류", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 403, description = "CSRF 헤더 누락", body = ErrorBody),
        (status = 404, description = "이야기 없음 (`story.notFound`)", body = ErrorBody),
    )
)]
async fn unlike_story(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    queries::require_exists(&state.pool, id).await?;
    queries::unlike(&state.pool, id, current.user.id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    path = "/api/stories/{id}/likes",
    params(("id" = Uuid, Path, description = "이야기 ID")),
    responses(
        (status = 200, description = "하트 누른 사람. 최신순", body = Vec<Like>),
        (status = 400, description = "ID 형식 오류", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 404, description = "이야기 없음 (`story.notFound`)", body = ErrorBody),
    )
)]
async fn list_story_likes(
    State(state): State<AppState>,
    _current: CurrentUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Vec<Like>>> {
    queries::require_exists(&state.pool, id).await?;
    Ok(Json(queries::likes(&state.pool, id).await?))
}

#[utoipa::path(
    get,
    path = "/api/stories/{id}/comments",
    params(("id" = Uuid, Path, description = "이야기 ID"), ListQuery),
    responses(
        (status = 200, description = "오래된 순 댓글", body = Page<StoryComment>),
        (status = 400, description = "쿼리 오류 (`request.invalidQuery`, `asset.invalidCursor`)", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 404, description = "이야기 없음 (`story.notFound`)", body = ErrorBody),
    )
)]
async fn list_story_comments(
    State(state): State<AppState>,
    _current: CurrentUser,
    Path(id): Path<Uuid>,
    Query(q): Query<ListQuery>,
) -> AppResult<Json<Page<StoryComment>>> {
    let limit = check_limit(q.limit)?;
    let after = q.cursor.as_deref().map(cursor::decode).transpose()?;
    queries::require_exists(&state.pool, id).await?;
    let items = queries::list_comments(&state.pool, id, after, limit + 1).await?;
    Ok(Json(into_page(items, limit, |c| (c.created_at, c.id))))
}

#[utoipa::path(
    post,
    path = "/api/stories/{id}/comments",
    params(("id" = Uuid, Path, description = "이야기 ID")),
    request_body = CommentRequest,
    responses(
        (status = 201, description = "작성됨", body = StoryComment),
        (status = 400, description = "본문 오류 (`comment.bodyInvalid`, `comment.mentionInvalid`)", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 403, description = "CSRF 헤더 누락", body = ErrorBody),
        (status = 404, description = "이야기 없음 (`story.notFound`)", body = ErrorBody),
    )
)]
async fn create_story_comment(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(id): Path<Uuid>,
    JsonBody(req): JsonBody<CommentRequest>,
) -> AppResult<(StatusCode, Json<StoryComment>)> {
    let mut tx = state.pool.begin().await?;
    queries::require_exists(&mut *tx, id).await?;
    let body = validate(&mut *tx, &req.body).await?;
    let comment = queries::insert_comment(&mut *tx, id, current.user.id, body).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(comment)))
}

#[utoipa::path(
    patch,
    path = "/api/story-comments/{id}",
    params(("id" = Uuid, Path, description = "댓글 ID")),
    request_body = CommentRequest,
    responses(
        (status = 200, description = "고쳐짐", body = StoryComment),
        (status = 400, description = "본문 오류 (`comment.bodyInvalid`, `comment.mentionInvalid`)", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 403, description = "작성자 아님 (`comment.forbidden`) 또는 CSRF 헤더 누락", body = ErrorBody),
        (status = 404, description = "댓글 없음 (`comment.notFound`)", body = ErrorBody),
    )
)]
async fn update_story_comment(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(id): Path<Uuid>,
    JsonBody(req): JsonBody<CommentRequest>,
) -> AppResult<Json<StoryComment>> {
    let author = queries::comment_author(&state.pool, id)
        .await?
        .ok_or(AppError::NotFound("comment.notFound"))?;
    check_can_edit(&current, author)?;
    let body = validate(&state.pool, &req.body).await?;
    queries::update_comment_body(&state.pool, id, body)
        .await?
        .map(Json)
        .ok_or(AppError::NotFound("comment.notFound"))
}

#[utoipa::path(
    delete,
    path = "/api/story-comments/{id}",
    params(("id" = Uuid, Path, description = "댓글 ID")),
    responses(
        (status = 204, description = "지워짐"),
        (status = 400, description = "ID 형식 오류 (`request.invalidPath`)", body = ErrorBody),
        (status = 401, description = "인증 필요", body = ErrorBody),
        (status = 403, description = "작성자나 owner, guardian 아님 (`comment.forbidden`) 또는 CSRF 헤더 누락", body = ErrorBody),
        (status = 404, description = "댓글 없음 (`comment.notFound`)", body = ErrorBody),
    )
)]
async fn delete_story_comment(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let author = queries::comment_author(&state.pool, id)
        .await?
        .ok_or(AppError::NotFound("comment.notFound"))?;
    check_can_delete(&current, author)?;
    if !queries::delete_comment(&state.pool, id).await? {
        return Err(AppError::NotFound("comment.notFound"));
    }
    Ok(StatusCode::NO_CONTENT)
}
