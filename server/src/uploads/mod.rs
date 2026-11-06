pub mod finalize;
pub mod locks;
pub mod queries;
pub mod tus;

use std::{io, path::Path, time::Duration};

use chrono::{DateTime, Utc};
use serde_json::Value;
use uuid::Uuid;

use crate::media::storage;

/// tus 업로드 최대 크기 (8 GiB).
pub const MAX_UPLOAD_BYTES: u64 = 8_589_934_592;

/// PATCH 본문 무수신 한도. 초과 시 연결 끊김과 동일 처리(FIN/RST 없는 반개방 연결의 락 무기한 보유 방지).
/// `AppState::upload_idle_timeout` 기본값.
pub const UPLOAD_IDLE_TIMEOUT: Duration = Duration::from_secs(60);

/// 진행 중인 tus 업로드. offset 은 임시 파일 길이.
#[derive(Debug, Clone)]
pub struct Upload {
    pub id: Uuid,
    pub user_id: Uuid,
    pub length: i64,
    /// 디코드한 `Upload-Metadata` 키·값 문자열 객체. 값 없는 키는 `""`.
    pub metadata: Value,
    pub expires_at: DateTime<Utc>,
}

/// 임시 파일 삭제. 이미 없으면 성공.
pub async fn remove_temp_file(data_dir: &Path, id: Uuid) -> io::Result<()> {
    match tokio::fs::remove_file(storage::upload_temp_path(data_dir, id)).await {
        Err(err) if err.kind() != io::ErrorKind::NotFound => Err(err),
        _ => Ok(()),
    }
}
