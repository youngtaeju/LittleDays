# LittleDays

셀프호스팅 가족용 아기 포토 저널입니다. 서버 하나가 가족 하나를 담당하며, 사진과 영상의 원본은 업로드한 바이트 그대로 보존합니다. 외부 클라우드, 광고, 추적 없이 직접 운영하는 서버에서만 동작합니다.

- 서버: Rust (axum, sqlx, PostgreSQL)
- 웹: React + TypeScript SPA, PWA
- 앱: Capacitor (후속 단계)

## 개발 환경

필요한 도구는 다음과 같습니다.

- Docker
- Rust (툴체인은 `rust-toolchain.toml` 로 고정)
- `sqlx-cli`: 마이그레이션 적용과 SQL 쿼리 검사에 사용합니다.
  `cargo install sqlx-cli --version 0.8.6 --locked --no-default-features --features postgres,rustls`
- Node.js 24 이상과 pnpm: 웹 프런트엔드 빌드에 사용합니다. pnpm 버전은 `web/package.json` 의 `packageManager` 로 고정합니다.
- 이미지·영상 처리용 시스템 패키지: 서버 빌드와 실행에 필요합니다. 아래는 Ubuntu 24.04 기준입니다.
  `sudo apt-get install -y --no-install-recommends pkg-config zlib1g-dev libheif-dev libheif-plugin-libde265 libheif-plugin-aomenc libheif-plugin-dav1d ffmpeg`

### 실행

```bash
scripts/dev-db.sh             # PowerShell 7+: scripts/dev-db.ps1
cd server && cargo run -- serve
```

다른 터미널에서 확인합니다.

```bash
curl http://localhost:8080/api/health
```

`scripts/dev-db.*` 는 개발용 PostgreSQL 기동, `server/.env` 생성(없을 때만, `SECRET_KEY` 자동 생성), 마이그레이션(`cargo sqlx migrate run`)을 차례로 실행합니다. `.ps1` 은 PowerShell 7 이상이 필요하고, Windows 에서 `.sh` 는 Git Bash 또는 WSL 에서 실행합니다.

서버는 빌드할 때 sqlx 가 SQL 쿼리를 개발용 DB 스키마와 대조하므로, 마이그레이션이 적용되지 않은 DB 에서는 빌드가 실패합니다. 마이그레이션이 추가된 변경을 받은 뒤에는 빌드 전에 `scripts/dev-db.*` 를 다시 실행합니다.

### 웹

서버를 `PORT=18080` 으로 실행한 상태에서 다른 터미널에서 웹 개발 서버를 띄웁니다. 개발 서버는 `/api` 요청을 `http://127.0.0.1:18080` 으로 프록시합니다.

```bash
cd server && PORT=18080 cargo run -- serve
cd web && pnpm install && pnpm dev
```

웹의 API 타입은 서버 OpenAPI 문서에서 생성합니다. 서버 API 가 바뀌면 문서와 타입을 다시 생성해 함께 커밋합니다.

```bash
cd server && cargo run -q -- openapi > ../web/openapi.json && cd ../web && pnpm gen:api
```

`web/openapi.json` 과 `web/src/api/schema.d.ts` 는 CI 에서 최신 여부를 검사합니다.

빌드된 웹을 서버 한 프로세스로 함께 서빙할 수도 있습니다. `web/dist` 를 만든 뒤 서버를 `WEB_DIR` 과 함께 시작하면 같은 origin 에서 SPA 와 API 를 모두 받습니다. `WEB_DIR` 에는 `index.html` 이 있어야 합니다.

```bash
cd web && pnpm build
cd ../server && WEB_DIR=../web/dist PORT=18080 cargo run -- serve
```

### 포트

- 8080 포트가 사용 중이면 `server/.env` 의 `PORT` 를 바꿉니다.
- 5432 포트가 사용 중이면 `POSTGRES_PORT` 를 지정해 실행합니다. 이미 만든 `server/.env` 는 `DATABASE_URL` 의 포트를 직접 맞춰야 합니다.

  ```bash
  POSTGRES_PORT=5433 scripts/dev-db.sh
  ```

  ```powershell
  $env:POSTGRES_PORT = '5433'; ./scripts/dev-db.ps1
  ```

- API 문서(OpenAPI)는 `GET /api/openapi.json` 입니다.

### 테스트와 검사

`cargo test` 와 `cargo sqlx prepare` 는 개발용 DB 가 떠 있고 마이그레이션이 적용된 상태여야 하므로 `scripts/dev-db.*` 를 먼저 실행합니다. `server/` 에서 실행하면 `DATABASE_URL` 을 `server/.env` 에서 읽습니다. `.env` 가 없는 환경(CI 등)이나 다른 DB 를 쓸 때만 셸에 `DATABASE_URL` 을 지정합니다.

CI 와 같은 검사는 `server/` 에서 실행합니다.

```bash
cargo fmt --check
SQLX_OFFLINE=true cargo clippy --locked --all-targets -- -D warnings
cargo sqlx prepare --check -- --all-targets
cargo test --locked
```

PowerShell 에서는 `SQLX_OFFLINE` 을 환경 변수로 지정합니다. 이후 빌드에 영향을 주므로 실행 뒤 해제하거나 별도 셸을 사용합니다.

```powershell
$env:SQLX_OFFLINE = 'true'
cargo clippy --locked --all-targets -- -D warnings
Remove-Item Env:SQLX_OFFLINE
```

SQL 쿼리를 바꾼 뒤에는 `cargo sqlx prepare -- --all-targets` 를 실행하고 `server/.sqlx/` 를 함께 커밋합니다.

## 라이선스

AGPL-3.0-only. [LICENSE](LICENSE) 참조.
