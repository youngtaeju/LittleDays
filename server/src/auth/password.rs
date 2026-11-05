use argon2::{
    Argon2,
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
};
use rand::RngCore;

use crate::error::{AppError, AppResult};

/// Argon2id 기본 파라미터, 랜덤 salt. CPU 바운드이므로 호출측에서 `spawn_blocking`.
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

    #[test]
    fn verify_rejects_malformed_hash() {
        assert!(!verify("pw", "not-a-hash"));
        assert!(!verify("pw", ""));
    }
}
