//! 작업 큐 워커 루프.

use std::{panic::AssertUnwindSafe, path::Path, time::Duration};

use anyhow::anyhow;
use futures_util::FutureExt;
use tokio::{sync::watch, task::JoinHandle};
use uuid::Uuid;

use super::{ClaimedJob, Job};
use crate::{assets, error::AppResult, media::process, state::AppState};

/// 깨움 신호를 놓쳤을 때 대비한 큐 재확인 주기.
const POLL_INTERVAL: Duration = Duration::from_secs(5);

/// 한 작업의 최대 claim 횟수. 재기동 중단도 횟수에 포함되므로 1 보다 크게.
/// 프로세스를 죽이는 작업(OOM, 네이티브 크래시)의 크래시 루프 차단용.
const MAX_ATTEMPTS: i32 = 3;

/// `processing_error`·`last_error` 최대 길이(문자).
const ERROR_MAX_CHARS: usize = 500;

/// 작업 1개 처리. 큐가 비었으면 `false`.
/// 작업 자체 실패·패닉은 자산·작업 행에 기록하고 `Ok(true)`. `Err` 는 큐·DB 오류.
pub async fn run_next(state: &AppState) -> AppResult<bool> {
    let Some(ClaimedJob { id, job, attempts }) = super::claim(&state.pool).await? else {
        return Ok(false);
    };
    match job {
        Job::ProcessAsset { asset_id } if attempts > MAX_ATTEMPTS => {
            let err = anyhow!("processing interrupted repeatedly (attempts {attempts})");
            record_failure(state, id, asset_id, attempts, &err).await?;
        }
        Job::ProcessAsset { asset_id } => {
            match catch_panic(process::process_asset(state, asset_id)).await {
                Ok(()) => {
                    super::finish(&state.pool, id).await?;
                    tracing::info!(%asset_id, job_id = %id, "process_asset job finished");
                }
                Err(err) => record_failure(state, id, asset_id, attempts, &err).await?,
            }
        }
    }
    Ok(true)
}

/// 패닉을 일반 에러로. 워커 태스크 유지용.
async fn catch_panic<T>(fut: impl Future<Output = anyhow::Result<T>>) -> anyhow::Result<T> {
    AssertUnwindSafe(fut)
        .catch_unwind()
        .await
        .unwrap_or_else(|payload| {
            let msg = payload
                .downcast_ref::<&str>()
                .copied()
                .or_else(|| payload.downcast_ref::<String>().map(String::as_str))
                .unwrap_or("unknown payload");
            tracing::error!(panic = msg, "job panicked");
            Err(anyhow!("panic: {msg}"))
        })
}

/// 자산·작업 실패를 한 트랜잭션에 기록. 재처리 요청이 그 사이 상태를 보지 않게.
/// 자산 행이 그사이 사라졌으면 작업은 조용히 종료, 파생물 정리.
async fn record_failure(
    state: &AppState,
    job_id: Uuid,
    asset_id: Uuid,
    attempts: i32,
    err: &anyhow::Error,
) -> AppResult<()> {
    let message = error_message(err, &state.config.data_dir);
    let mut tx = state.pool.begin().await?;
    if assets::queries::mark_failed(&mut *tx, asset_id, &message).await? {
        super::fail(&mut *tx, job_id, &message).await?;
        tx.commit().await?;
        tracing::warn!(%asset_id, %job_id, attempts, error = ?err, "asset processing failed");
    } else {
        super::finish(&mut *tx, job_id).await?;
        tx.commit().await?;
        tracing::debug!(%asset_id, %job_id, error = ?err, "processing error after asset removal ignored");
        process::remove_orphan_derivatives(state, asset_id).await;
    }
    Ok(())
}

/// 에러 체인을 한 줄로, `ERROR_MAX_CHARS` 이내. `data_dir` 절대 경로는 `DATA_DIR` 로 치환.
fn error_message(err: &anyhow::Error, data_dir: &Path) -> String {
    let full = format!("{err:#}").replace(&*data_dir.to_string_lossy(), "DATA_DIR");
    let line = full.lines().next().unwrap_or_default();
    line.chars().take(ERROR_MAX_CHARS).collect()
}

/// `n` 개 워커. 큐가 비면 깨움·`POLL_INTERVAL`·종료 신호 중 먼저 오는 것까지 대기.
/// 종료 신호 후 새 작업을 집지 않고 반환. 진행 중 작업은 끝까지 처리.
pub fn spawn(state: AppState, n: usize, shutdown: watch::Receiver<bool>) -> Vec<JoinHandle<()>> {
    (0..n)
        .map(|_| {
            let state = state.clone();
            let mut shutdown = shutdown.clone();
            tokio::spawn(async move {
                while !*shutdown.borrow() {
                    let idle = match run_next(&state).await {
                        Ok(ran) => !ran,
                        Err(err) => {
                            // DB 장애 시 바쁜 재시도 방지. 유휴와 같은 대기.
                            tracing::error!(%err, "job queue error");
                            true
                        }
                    };
                    if idle {
                        tokio::select! {
                            _ = state.jobs_wake.notified() => {}
                            _ = tokio::time::sleep(POLL_INTERVAL) => {}
                            // 송신측 드롭도 종료로 간주.
                            _ = shutdown.wait_for(|stop| *stop) => break,
                        }
                    }
                }
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_message_is_single_bounded_line() {
        let err = anyhow::anyhow!("inner\nsecond line").context("decode");
        let dir = Path::new("/srv/data");
        assert_eq!(error_message(&err, dir), "decode: inner");
        let long = anyhow::anyhow!("{}", "가".repeat(600));
        assert_eq!(error_message(&long, dir).chars().count(), ERROR_MAX_CHARS);
    }

    #[test]
    fn error_message_masks_data_dir() {
        let err = anyhow::anyhow!("No such file").context("open /srv/data/originals/a.jpg");
        assert_eq!(
            error_message(&err, Path::new("/srv/data")),
            "open DATA_DIR/originals/a.jpg: No such file"
        );
    }

    #[tokio::test]
    async fn panic_becomes_error() {
        let err = catch_panic(async {
            panic!("boom {}", 1);
            #[allow(unreachable_code)]
            Ok(())
        })
        .await
        .unwrap_err();
        assert_eq!(err.to_string(), "panic: boom 1");

        let err = catch_panic::<()>(async { panic!("static") })
            .await
            .unwrap_err();
        assert_eq!(err.to_string(), "panic: static");

        assert_eq!(catch_panic(async { Ok(7) }).await.unwrap(), 7);
    }
}
