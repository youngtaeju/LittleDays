use std::net::SocketAddr;

use anyhow::Context;
use clap::{Parser, Subcommand};
use littledays::{
    app::build_router,
    config::Config,
    db, maintenance,
    media::storage,
    shutdown::{forced, shutdown_signal},
    state::AppState,
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
    init_tracing();

    let cli = Cli::parse();
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
            let mut serve_stop = stop.clone();
            // 종료 대기 대상은 한 future 로 묶어 유예와 경쟁. 워커 join 도 여기에 추가.
            let drain = async {
                axum::serve(listener, build_router(state))
                    .with_graceful_shutdown(async move {
                        let _ = serve_stop.wait_for(|v| *v).await;
                    })
                    .await?;
                maintenance.await?;
                anyhow::Ok(())
            };
            tokio::select! {
                res = drain => res?,
                _ = forced(stop, force) => tracing::warn!("shutdown forced"),
            }
            tracing::info!("shutdown complete");
        }
        Cmd::Migrate => {
            let config = Config::from_env()?;
            let pool = db::connect(&config.database_url).await?;
            db::migrate(&pool).await?;
            println!("migrations applied");
        }
    }
    Ok(())
}
