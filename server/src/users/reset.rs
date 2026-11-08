use rand::{Rng, distr::Alphanumeric};
use sqlx::PgPool;

use super::queries;
use crate::{auth::password, auth::session, error::AppResult};

const PASSWORD_LEN: usize = 20;

/// CLI 복구용. 새 비밀번호 설정 + 전체 세션 삭제. 정지 상태 유지. 사용자 없으면 `None`.
pub async fn reset_password(pool: &PgPool, username: &str) -> AppResult<Option<String>> {
    let new_password: String = rand::rng()
        .sample_iter(Alphanumeric)
        .take(PASSWORD_LEN)
        .map(char::from)
        .collect();
    let hash = password::hash_async(new_password.clone()).await?;

    let mut tx = pool.begin().await?;
    let Some(record) = queries::find_by_username(&mut *tx, username).await? else {
        return Ok(None);
    };
    queries::update_password(&mut *tx, record.user.id, &hash).await?;
    session::delete_all_for_user(&mut *tx, record.user.id).await?;
    tx.commit().await?;
    Ok(Some(new_password))
}
