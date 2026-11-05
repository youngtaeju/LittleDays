use std::{
    num::NonZeroUsize,
    sync::{Arc, LazyLock},
};

use argon2::{
    Argon2,
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
};
use rand::RngCore;
use tokio::sync::Semaphore;

use crate::error::{AppError, AppResult};

/// Argon2id 기본 파라미터, 랜덤 salt. CPU·메모리 바운드. 요청 경로에서는 `hash_async`.
pub fn hash(plain: &str) -> AppResult<String> {
    let mut salt_bytes = [0u8; 16];
    rand::rng().fill_bytes(&mut salt_bytes);
    let salt = SaltString::encode_b64(&salt_bytes)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("salt 인코딩 실패: {e}")))?;
    let hash = Argon2::default()
        .hash_password(plain.as_bytes(), &salt)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("비밀번호 해시 실패: {e}")))?;
    Ok(hash.to_string())
}

/// 해시 형식 오류도 불일치(false)로 처리.
pub fn verify(plain: &str, hash: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(hash) else {
        return false;
    };
    Argon2::default()
        .verify_password(plain.as_bytes(), &parsed)
        .is_ok()
}

/// 미존재 사용자 로그인의 응답 시간 균등화용. 결과 무시.
/// 더미 해시 생성 실패 시 검증 생략(로그인 실패 응답은 동일).
pub fn verify_dummy(plain: &str) {
    static DUMMY_HASH: LazyLock<Option<String>> =
        LazyLock::new(|| hash("littledays-dummy-password").ok());
    if let Some(dummy) = DUMMY_HASH.as_deref() {
        std::hint::black_box(verify(plain, dummy));
    }
}

/// 동시 Argon2 작업 상한(코어 수). 요청당 메모리 약 19 MiB 라 무제한 동시 실행 차단.
static PERMITS: LazyLock<Arc<Semaphore>> = LazyLock::new(|| {
    let n = std::thread::available_parallelism().map_or(2, NonZeroUsize::get);
    Arc::new(Semaphore::new(n))
});

/// 허가 획득 후 blocking 풀에서 실행. 허가는 작업 종료까지 유지(요청 취소 시에도 상한 보장).
async fn run_limited<T, F>(f: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    let permit = PERMITS
        .clone()
        .acquire_owned()
        .await
        .map_err(|e| AppError::Internal(e.into()))?;
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        f()
    })
    .await
    .map_err(|e| AppError::Internal(e.into()))
}

pub async fn hash_async(plain: String) -> AppResult<String> {
    run_limited(move || hash(&plain)).await?
}

pub async fn verify_async(plain: String, hash: String) -> AppResult<bool> {
    run_limited(move || verify(&plain, &hash)).await
}

pub async fn verify_dummy_async(plain: String) -> AppResult<()> {
    run_limited(move || verify_dummy(&plain)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_then_verify() {
        let h = hash("pw").unwrap();
        assert!(verify("pw", &h));
        assert!(!verify("x", &h));
    }

    #[test]
    fn hash_uses_random_salt() {
        assert_ne!(hash("pw").unwrap(), hash("pw").unwrap());
    }

    #[tokio::test]
    async fn async_wrappers_match_sync() {
        let h = hash_async("pw".to_string()).await.unwrap();
        assert!(verify_async("pw".to_string(), h.clone()).await.unwrap());
        assert!(!verify_async("x".to_string(), h).await.unwrap());
        verify_dummy_async("pw".to_string()).await.unwrap();
    }

    #[test]
    fn verify_rejects_malformed_hash() {
        assert!(!verify("pw", "not-a-hash"));
        assert!(!verify("pw", ""));
    }
}
