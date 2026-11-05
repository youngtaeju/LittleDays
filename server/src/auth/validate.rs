use crate::error::{AppError, AppResult};

/// 가입·초대 수락 공용. 정규화(소문자) 사용자명 반환.
pub fn validate_credentials(username: &str, password: &str) -> AppResult<String> {
    let username = username.to_lowercase();
    let len = username.chars().count();
    let valid_chars = username
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
    if !(3..=32).contains(&len) || !valid_chars {
        return Err(AppError::bad_request("auth.usernameInvalid"));
    }
    if password.chars().count() < 8 {
        return Err(AppError::bad_request("auth.passwordTooShort"));
    }
    Ok(username)
}

/// 앞뒤 공백 제거 후 1~64자.
pub fn validate_display_name(raw: &str) -> AppResult<String> {
    trimmed_name(raw, "auth.displayNameInvalid")
}

/// 앞뒤 공백 제거 후 1~64자. 실패 시 `key` 로 400.
pub fn trimmed_name(raw: &str, key: &'static str) -> AppResult<String> {
    let name = raw.trim();
    if (1..=64).contains(&name.chars().count()) {
        Ok(name.to_string())
    } else {
        Err(AppError::bad_request(key))
    }
}
