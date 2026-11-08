#!/usr/bin/env bash
# 이미지 태그로 compose 스택(빈 DB) 기동·정리. smoke.sh 는 source, e2e 는 직접 실행.
# 직접 실행: docker/stack.sh up|down|logs [이미지 태그]   (기본 littledays:dev)
#   호스트 포트 STACK_PORT(기본 18090), 작업 디렉터리 STACK_DIR(기본 임시 디렉터리 아래 고정 경로)
# source 시 호출 측이 IMAGE, PORT, PROJECT, WORK, PUID 지정.

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

compose() {
    docker compose -p "$PROJECT" -f "$WORK/docker-compose.yml" -f "$WORK/stack.override.yml" "$@"
}

wait_healthy() {
    local deadline=$((SECONDS + 90))
    until curl -fsS -o /dev/null "http://localhost:$PORT/api/health" 2>/dev/null; do
        if [ "$SECONDS" -ge "$deadline" ]; then fail "/api/health 90초 안에 200 아님"; fi
        if [ -z "$(compose ps -q --status running app)" ]; then fail "app 컨테이너 실행 중 아님"; fi
        sleep 2
    done
}

# 운영용 compose + 이미지 교체 override + .env. PUBLIC_URL 은 http(세션 쿠키 Secure 아님).
stack_write() {
    local root secret
    root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    mkdir -p "$WORK"
    cp "$root/compose/docker-compose.yml" "$WORK/"
    cat >"$WORK/stack.override.yml" <<EOF
services:
  app:
    image: $IMAGE
EOF
    secret="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    cat >"$WORK/.env" <<EOF
PORT=$PORT
POSTGRES_PASSWORD=stack
DATABASE_URL=postgres://littledays:stack@postgres:5432/littledays
PUBLIC_URL=http://localhost:$PORT
SECRET_KEY=$secret
PUID=$PUID
PGID=$PUID
EOF
}

stack_down() {
    [ -f "$WORK/stack.override.yml" ] || return 0
    compose down -v --remove-orphans >/dev/null 2>&1 || true
    # bind mount 디렉터리는 root·postgres 소유. 컨테이너 안에서 삭제.
    docker run --rm --entrypoint rm -v "$WORK:/w" "$IMAGE" -rf /w/data /w/postgres >/dev/null 2>&1 || true
    rm -rf "$WORK"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    set -euo pipefail
    IMAGE="${2:-littledays:dev}"
    PORT="${STACK_PORT:-18090}"
    PROJECT=littledays-e2e
    PUID="$(id -u)"
    WORK="${STACK_DIR:-${TMPDIR:-/tmp}/littledays-e2e}"
    case "${1:-}" in
    up)
        # 이전 실행 잔여물 정리. 항상 빈 DB 에서 시작.
        stack_down
        stack_write
        # 기동 실패 시 로그 출력 후 정리.
        trap 'status=$?; if [ "$status" -ne 0 ]; then compose logs --no-color app >&2 || true; stack_down; fi' EXIT
        compose up -d --quiet-pull
        wait_healthy
        echo "stack up: http://localhost:$PORT"
        ;;
    down)
        stack_down
        ;;
    logs)
        [ -f "$WORK/stack.override.yml" ] || fail "기동한 스택 없음"
        compose logs --no-color app postgres
        ;;
    *)
        echo "사용: $0 up|down|logs [이미지 태그]" >&2
        exit 2
        ;;
    esac
fi
