#!/usr/bin/env bash
# 개발용 Postgres 기동 + server/.env 생성(없을 때만) + 마이그레이션.
# POSTGRES_PORT 지정 시 compose 호스트 포트와 DATABASE_URL 포트에 반영.
# 마이그레이션은 sqlx-cli 사용. 앱 빌드 자체가 마이그레이션된 DB 요구(sqlx 매크로) → 앱 바이너리로는 빈 DB 마이그레이션 불가.
set -euo pipefail

if ! cargo sqlx --version >/dev/null 2>&1; then
  echo "sqlx-cli 필요: cargo install sqlx-cli --version 0.8.6 --locked --no-default-features --features postgres,rustls" >&2
  exit 1
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="$root/server/.env"

docker compose -f "$root/compose/docker-compose.dev.yml" up -d --wait

if [ ! -e "$env_file" ]; then
  if command -v openssl >/dev/null 2>&1; then
    key="$(openssl rand -hex 32)"
  else
    key="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
  fi
  sed -e "s/^SECRET_KEY=.*/SECRET_KEY=$key/" "$root/server/.env.example" > "$env_file"
  if [ -n "${POSTGRES_PORT:-}" ]; then
    sed -E -i.bak "s#^(DATABASE_URL=.*@[^:/]+):[0-9]+/#\1:${POSTGRES_PORT}/#" "$env_file"
    rm -f "$env_file.bak"
  fi
  echo "server/.env 생성"
fi

cd "$root/server"
cargo sqlx migrate run
