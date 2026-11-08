# LittleDays

셀프호스팅 가족용 아기 포토 저널입니다. 서버 하나가 가족 하나를 담당하며, 사진과 영상의 원본은 업로드한 바이트 그대로 보존합니다. 외부 클라우드, 광고, 추적 없이 직접 운영하는 서버에서만 동작합니다.

- 서버: Rust (axum, sqlx, PostgreSQL)
- 웹: React + TypeScript SPA, PWA
- 앱: Capacitor (후속 단계)

## 설치

Docker 와 Docker Compose 가 있는 서버(홈서버, NAS 등)에서 실행합니다. 이미지는 `ghcr.io/youngtaeju/littledays` 이며 `linux/amd64` 를 지원합니다. 내려받는 크기는 약 211 MB 입니다. 외부 의존은 PostgreSQL 하나이고 compose 에 포함되어 있습니다.

1. `compose/` 디렉터리의 `docker-compose.yml` 과 `.env.example` 을 서버의 작업 디렉터리에 복사하고, `.env.example` 을 `.env` 로 바꿔 값을 채웁니다.

   - `SECRET_KEY`: `openssl rand -hex 32` 로 만든 64자 16진수입니다.
   - `POSTGRES_PASSWORD`: DB 비밀번호입니다. `DATABASE_URL` 안의 비밀번호와 같은 값이어야 합니다. 영숫자를 권장하며, 특수문자는 `DATABASE_URL` 에서 URL 인코딩이 필요합니다.
   - `PUBLIC_URL`: 브라우저로 접속하는 주소입니다. 리버스 프록시 뒤라면 그 https 주소입니다.
   - `PUID`, `PGID`: `./data` 디렉터리를 소유할 호스트 사용자입니다. 호스트에서 `id -u`, `id -g` 로 확인합니다.

2. 실행합니다.

   ```bash
   docker compose up -d
   ```

   데이터베이스 마이그레이션은 기동할 때 자동으로 적용됩니다. 원본과 파생물은 `./data`, 데이터베이스는 `./postgres` 에 저장됩니다.

3. 브라우저에서 `PUBLIC_URL` 주소(기본 `http://localhost:8080`)를 열고 첫 가입을 합니다. 첫 번째로 가입한 계정이 소유자(owner)가 되며, 이후 가족은 소유자가 만든 초대 링크로 가입합니다.

compose 의 `ports` 는 호스트의 모든 인터페이스에 포트를 엽니다. 같은 호스트에서 리버스 프록시를 운영한다면 `127.0.0.1` 에만 바인딩합니다.

```yaml
    ports:
      - "127.0.0.1:${PORT:-8080}:8080"
```

리버스 프록시, https, 백업, 메모리 등 운영 안내는 [docs/operations.md](docs/operations.md) 를 참고하십시오.

### 업그레이드

`.env` 의 `LITTLEDAYS_VERSION` 을 새 버전으로 바꾼 뒤 다음을 실행합니다. 기본값 `latest` 를 쓰는 경우 값 변경 없이 실행합니다.

```bash
docker compose pull && docker compose up -d
```

새 버전의 마이그레이션은 기동할 때 자동으로 적용됩니다. 업그레이드 전에 백업을 권장합니다([백업](docs/operations.md#백업)).

### 지원 브라우저

- 최근 2년 이내 버전의 Chrome, Edge, Firefox, Safari
- iOS 16.4 이상의 Safari (홈 화면에 추가한 PWA 포함)
- Android 의 Chrome

`Intl.supportedValuesOf` 를 지원하지 않는 브라우저에서는 시간대 선택에 현재 값만 표시됩니다. PWA 설치와 서비스 워커는 https(또는 localhost)에서만 동작합니다.

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

Docker 이미지에는 서드파티 패키지가 함께 들어 있으며 각각의 라이선스를 따릅니다. 예를 들어 Debian 의 ffmpeg 는 GPL 구성요소(x264, x265 등)를 링크하고, 이미지에는 libheif 등도 포함됩니다. 해당 패키지의 소스는 Debian 에서 받을 수 있습니다.
