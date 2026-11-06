use std::time::Duration;

use tokio::{sync::watch, task::JoinHandle};

use crate::{auth::session, error::AppResult, state::AppState, uploads};

const INTERVAL: Duration = Duration::from_secs(3600);

/// 정리 작업 1회 실행. 단계별 독립(에러는 단계마다 기록 후 다음 단계 진행). 반환은 첫 에러.
pub async fn run_once(state: &AppState) -> AppResult<()> {
    let steps = [
        (
            "expired sessions",
            session::delete_expired(&state.pool).await,
        ),
        (
            "expired uploads",
            uploads::queries::delete_expired(state).await,
        ),
    ];
    let mut first_err = None;
    for (step, result) in steps {
        match result {
            Ok(0) => {}
            Ok(count) => tracing::info!(step, count, "maintenance step removed rows"),
            Err(err) => {
                tracing::error!(step, %err, "maintenance step failed");
                first_err.get_or_insert(err);
            }
        }
    }
    first_err.map_or(Ok(()), Err)
}

/// 기동 직후 1회, 이후 1시간마다 `run_once`. 종료 신호 시 즉시 반환.
pub fn spawn(state: AppState, mut shutdown: watch::Receiver<bool>) -> JoinHandle<()> {
    tokio::spawn(async move {
        loop {
            // 에러는 단계별로 run_once 가 기록.
            let _ = run_once(&state).await;
            tokio::select! {
                _ = tokio::time::sleep(INTERVAL) => {}
                // 송신측 드롭도 종료로 간주.
                _ = shutdown.wait_for(|stop| *stop) => break,
            }
        }
    })
}
