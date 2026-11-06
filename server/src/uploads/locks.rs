use std::{
    collections::HashMap,
    sync::{Arc, Mutex, PoisonError},
};

use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard};
use uuid::Uuid;

/// 업로드별 배타 락 (PATCH·finalize·삭제). 단일 프로세스 전제. 대기 없이 즉시 실패.
#[derive(Default)]
pub struct UploadLocks {
    locks: Mutex<HashMap<Uuid, Arc<AsyncMutex<()>>>>,
}

impl UploadLocks {
    /// 다른 보유자가 있으면 `None`.
    pub fn try_acquire(&self, id: Uuid) -> Option<OwnedMutexGuard<()>> {
        let lock = self
            .locks
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .entry(id)
            .or_default()
            .clone();
        lock.try_lock_owned().ok()
    }

    /// 업로드 행·임시 파일 제거 후 락 보유 상태에서 호출. 항목 누적 방지용.
    pub fn remove(&self, id: Uuid) {
        self.locks
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(&id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn second_acquire_fails_until_release() {
        let locks = UploadLocks::default();
        let id = Uuid::now_v7();
        let guard = locks.try_acquire(id).unwrap();
        assert!(locks.try_acquire(id).is_none());
        assert!(locks.try_acquire(Uuid::now_v7()).is_some());
        drop(guard);
        assert!(locks.try_acquire(id).is_some());
    }
}
