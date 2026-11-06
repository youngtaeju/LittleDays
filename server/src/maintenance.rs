use std::time::Duration;

use tokio::{sync::watch, task::JoinHandle};

use crate::{auth::session, error::AppResult, state::AppState};

const INTERVAL: Duration = Duration::from_secs(3600);

/// 정리 작업 1회 실행. 순서대로 호출, 첫 에러에서 중단.
pub async fn run_once(state: &AppState) -> AppResult<()> {
    let sessions = session::delete_expired(&state.pool).await?;
    if sessions > 0 {
        tracing::info!(count = sessions, "expired sessions removed");
    }
    Ok(())
}

/// 기동 직후 1회, 이후 1시간마다 `run_once`. 에러는 로그만. 종료 신호 시 즉시 반환.
pub fn spawn(state: AppState, mut shutdown: watch::Receiver<bool>) -> JoinHandle<()> {
    tokio::spawn(async move {
        loop {
            if let Err(err) = run_once(&state).await {
                tracing::error!(%err, "maintenance failed");
            }
            tokio::select! {
                _ = tokio::time::sleep(INTERVAL) => {}
                // 송신측 드롭도 종료로 간주.
                _ = shutdown.wait_for(|stop| *stop) => break,
            }
        }
    })
}
