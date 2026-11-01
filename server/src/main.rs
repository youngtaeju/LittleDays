use clap::{Parser, Subcommand};

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
        Cmd::Serve => tracing::info!("serve: not implemented yet"),
        Cmd::Migrate => tracing::info!("migrate: not implemented yet"),
    }
    Ok(())
}
