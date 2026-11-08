use std::time::Duration;

use tokio::{sync::watch, task::JoinHandle};

use crate::{
    assets::trash, auth::session, error::AppResult, media::orphans, state::AppState, uploads,
};

const INTERVAL: Duration = Duration::from_secs(3600);
/// 고아 파일 판정 유예. 진행 중 업로드·finalize 와의 경합 방지.
const ORPHAN_GRACE: Duration = Duration::from_secs(24 * 3600);

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
        ("expired trash", trash::purge_expired(state).await),
        (
            "orphan files",
            orphans::sweep(state, ORPHAN_GRACE).await.map(|report| {
                if report != orphans::SweepReport::default() {
                    tracing::info!(
                        temp_removed = report.temp_removed,
                        derivatives_removed = report.derivatives_removed,
                        originals_moved = report.originals_moved,
                        "orphan file sweep finished"
                    );
                }
                // 건수는 위에서 개별 기록. 단계 공통 로그 생략.
                0
            }),
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
