use std::net::SocketAddr;

use anyhow::Context;
use clap::{Parser, Subcommand};
use littledays::{
    app::{build_router, openapi},
    config::{self, Config},
    db, jobs, maintenance,
    media::{storage, video},
    shutdown::{forced, shutdown_signal},
    state::AppState,
    users::reset,
};

#[derive(Parser)]
#[command(name = "littledays", version, about = "LittleDays server")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// HTTP 서버 + 워커 기동
    Serve,
    /// DB 마이그레이션 적용
    Migrate,
    /// 사용자 비밀번호를 새 무작위 값으로 재설정하고 표준 출력에 출력. 세션 전부 삭제
    ResetPassword {
        /// 대상 사용자명
        username: String,
    },
    /// OpenAPI 문서를 표준 출력으로 출력 (설정, DB 불필요)
    Openapi,
}

fn init_tracing() {
    use tracing_subscriber::{EnvFilter, fmt};
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    fmt().with_env_filter(filter).init();
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // .env 는 개발 편의용. 없어도 무시.
    dotenvy::dotenv().ok();

    let cli = Cli::parse();
    // openapi 는 표준 출력 JSON 오염 방지를 위해 로그 초기화 제외.
    if !matches!(cli.cmd, Cmd::Openapi) {
        init_tracing();
    }
    match cli.cmd {
        Cmd::Serve => {
            let config = Config::from_env()?;
            let pool = db::connect(&config.database_url).await?;
            if config.auto_migrate {
                db::migrate(&pool).await?;
            }
            let addr = SocketAddr::from(([0, 0, 0, 0], config.port));
            storage::ensure_dirs(&config.data_dir)
                .with_context(|| format!("DATA_DIR {} 준비 실패", config.data_dir.display()))?;
            let state = AppState::new(pool, config);
            let listener = tokio::net::TcpListener::bind(addr).await?;
            tracing::info!(%addr, "listening");
            let (stop, force) = shutdown_signal()?;
            let maintenance = maintenance::spawn(state.clone(), stop.clone());
            video::check_tools().await;
            let requeued = jobs::requeue_running(&state.pool).await?;
            if requeued > 0 {
                tracing::info!(count = requeued, "requeued interrupted jobs");
            }
            let concurrency = state.config.worker_concurrency;
            let workers = jobs::worker::spawn(state.clone(), concurrency, stop.clone());
            tracing::info!(concurrency, "workers started");
            let mut serve_stop = stop.clone();
            // 종료 대기 대상은 한 future 로 묶어 유예와 경쟁.
            let drain = async {
                axum::serve(listener, build_router(state))
                    .with_graceful_shutdown(async move {
                        let _ = serve_stop.wait_for(|v| *v).await;
                    })
                    .await?;
                maintenance.await?;
                // 한 워커의 실패가 나머지 join 을 막지 않게.
                for worker in workers {
                    if let Err(err) = worker.await {
                        tracing::error!(%err, "worker task failed");
                    }
                }
                anyhow::Ok(())
            };
            tokio::select! {
                res = drain => res?,
                _ = forced(stop, force) => tracing::warn!("shutdown forced"),
            }
            tracing::info!("shutdown complete");
        }
        Cmd::Migrate => {
            let pool = db::connect(&config::database_url()?).await?;
            db::migrate(&pool).await?;
            println!("migrations applied");
        }
        Cmd::ResetPassword { username } => {
            let pool = db::connect(&config::database_url()?).await?;
            match reset::reset_password(&pool, &username).await? {
                Some(password) => println!("{password}"),
                None => {
                    eprintln!("user not found: {username}");
                    std::process::exit(1);
                }
            }
        }
        Cmd::Openapi => println!("{}", serde_json::to_string_pretty(&openapi())?),
    }
    Ok(())
}
