#!/bin/sh
# PUID/PGID 사용자로 권한 낮춘 뒤 서버 실행. DATA_DIR 소유권 보정.
set -eu

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
DATA_DIR="${DATA_DIR:-/data}"

# --user 로 이미 비 root 실행 시 전환 불가. 그대로 실행.
if [ "$(id -u)" != "0" ]; then
    exec /app/littledays "$@"
fi

# 같은 id 가 이미 있으면 재사용(컨테이너 재시작, 기존 시스템 그룹 등).
if ! getent group "$PGID" >/dev/null; then
    groupadd -g "$PGID" littledays
fi
if ! getent passwd "$PUID" >/dev/null; then
    useradd -u "$PUID" -g "$PGID" -d /app -M -s /usr/sbin/nologin littledays
fi

mkdir -p "$DATA_DIR"

# 인자: 경로, chown 옵션. 소유자가 이미 맞으면 생략.
# 재귀 chown 은 소유자가 다른 하위 디렉터리만. 매 기동 전체 순회 방지.
fix_owner() {
    path=$1
    shift
    if [ "$(stat -c %u:%g "$path")" != "$PUID:$PGID" ]; then
        chown "$@" "$PUID:$PGID" "$path" \
            || echo "entrypoint: chown $path 실패. 쓰기 권한 확인 필요" >&2
    fi
}

fix_owner "$DATA_DIR"
for sub in originals derivatives tmp orphans; do
    if [ -e "$DATA_DIR/$sub" ]; then
        fix_owner "$DATA_DIR/$sub" -R
    fi
done

exec setpriv --reuid="$PUID" --regid="$PGID" --init-groups /app/littledays "$@"
