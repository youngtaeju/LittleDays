# LittleDays

셀프호스팅 가족용 아기 포토 저널입니다. 서버 하나가 가족 하나를 담당하며, 사진과 영상의 원본은 업로드한 바이트 그대로 보존합니다. 외부 클라우드, 광고, 추적 없이 직접 운영하는 서버에서만 동작합니다.

- 서버: Rust (axum, sqlx, PostgreSQL)
- 웹: React + TypeScript SPA, PWA
- 앱: Capacitor (후속 단계)

## 개발 환경

```bash
# PostgreSQL (127.0.0.1:5432, 변경은 POSTGRES_PORT)
docker compose -f compose/docker-compose.dev.yml up -d --wait

cd server
cp .env.example .env          # SECRET_KEY 는 openssl rand -hex 32 로 생성
cargo run -- migrate
cargo run -- serve            # http://localhost:8080
```

검증 명령: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`

## 라이선스

AGPL-3.0-only. [LICENSE](LICENSE) 참조.
