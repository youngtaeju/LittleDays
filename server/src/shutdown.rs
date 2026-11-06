use std::{io, time::Duration};

use tokio::sync::watch;

/// 첫 신호 수신 후 정상 종료 대기 상한.
pub const GRACE: Duration = Duration::from_secs(20);

/// SIGTERM/SIGINT 수신기. 핸들러는 생성 시점에 동기 등록.
struct Signals {
    #[cfg(unix)]
    term: tokio::signal::unix::Signal,
    #[cfg(unix)]
    int: tokio::signal::unix::Signal,
}

impl Signals {
    #[cfg(unix)]
    fn new() -> io::Result<Self> {
        use tokio::signal::unix::{SignalKind, signal};
        Ok(Self {
            term: signal(SignalKind::terminate())?,
            int: signal(SignalKind::interrupt())?,
        })
    }

    #[cfg(not(unix))]
    fn new() -> io::Result<Self> {
        Ok(Self {})
    }

    #[cfg(unix)]
    async fn recv(&mut self) {
        tokio::select! {
            _ = self.term.recv() => {},
            _ = self.int.recv() => {},
        }
    }

    #[cfg(not(unix))]
    async fn recv(&mut self) {
        if let Err(err) = tokio::signal::ctrl_c().await {
            tracing::error!(%err, "ctrl+c handler failed");
            std::future::pending::<()>().await;
        }
    }
}

/// 종료 신호 수신기 쌍. `stop` 은 첫 신호, `force` 는 두 번째 신호에 `true`.
/// tokio 런타임 안에서 호출.
pub fn shutdown_signal() -> io::Result<(watch::Receiver<bool>, watch::Receiver<bool>)> {
    let mut signals = Signals::new()?;
    let (stop_tx, stop_rx) = watch::channel(false);
    let (force_tx, force_rx) = watch::channel(false);
    tokio::spawn(async move {
        signals.recv().await;
        tracing::info!("shutdown signal received");
        let _ = stop_tx.send(true);
        signals.recv().await;
        tracing::warn!("second shutdown signal received");
        let _ = force_tx.send(true);
    });
    Ok((stop_rx, force_rx))
}

/// 첫 신호 후 유예 초과 또는 두 번째 신호까지 대기.
pub async fn forced(mut stop: watch::Receiver<bool>, mut force: watch::Receiver<bool>) {
    let _ = stop.wait_for(|v| *v).await;
    tokio::select! {
        _ = tokio::time::sleep(GRACE) => tracing::warn!("shutdown grace period exceeded"),
        _ = force.wait_for(|v| *v) => {},
    }
}
