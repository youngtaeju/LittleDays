# syntax=docker/dockerfile:1
# 빌드 컨텍스트: 레포 루트. docker build -f docker/Dockerfile .

FROM node:24-trixie-slim AS web
# pnpm 버전은 package.json 의 packageManager 기준.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /src/web
COPY web/package.json web/pnpm-lock.yaml ./
RUN --mount=type=cache,id=littledays-pnpm,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir /pnpm-store
COPY web/ ./
RUN pnpm build

FROM rust:1.99-trixie AS server
RUN apt-get update \
    && apt-get install -y --no-install-recommends pkg-config zlib1g-dev libheif-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src/server
COPY server/ ./
# sqlx 매크로는 커밋된 .sqlx/ 로 검사. 빌드에 DB 불필요.
ENV SQLX_OFFLINE=true
# target 은 캐시 마운트라 결과물을 레이어로 복사.
RUN --mount=type=cache,id=littledays-cargo-registry,target=/usr/local/cargo/registry \
    --mount=type=cache,id=littledays-target,target=/src/server/target \
    cargo build --release --locked \
    && cp target/release/littledays /littledays

FROM debian:trixie-slim AS runtime
# --no-install-recommends: libheif1 의 Recommends 인 x265(GPL) 플러그인 제외.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates curl ffmpeg libheif1 \
        libheif-plugin-libde265 libheif-plugin-dav1d libheif-plugin-aomenc \
    && rm -rf /var/lib/apt/lists/*
COPY --from=server /littledays /app/littledays
COPY --from=web /src/web/dist /app/web
COPY --chmod=755 docker/entrypoint.sh /app/entrypoint.sh
ENV DATA_DIR=/data \
    WEB_DIR=/app/web \
    PORT=8080 \
    LOG_FORMAT=json \
    AUTO_MIGRATE=true \
    PUID=1000 \
    PGID=1000
WORKDIR /app
EXPOSE 8080
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["serve"]
