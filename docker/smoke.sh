#!/usr/bin/env bash
# 빌드한 이미지로 compose 기동 후 기본 동작 확인.
# 사용: docker/smoke.sh [이미지 태그]   (기본 littledays:dev, 호스트 포트 SMOKE_PORT 기본 18090)
set -euo pipefail

IMAGE="${1:-littledays:dev}"
PORT="${SMOKE_PORT:-18090}"
PROJECT=littledays-smoke
PUID=1234
WORK="$(mktemp -d)"
BASE="http://localhost:$PORT"
# shellcheck source=docker/stack.sh
. "$(dirname "$0")/stack.sh"

in_image() {
    local entry=$1
    shift
    docker run --rm --entrypoint "$entry" "$IMAGE" "$@"
}

cleanup() {
    local status=$?
    if [ "$status" -ne 0 ] && [ -f "$WORK/stack.override.yml" ]; then
        compose logs --no-color app >&2 || true
    fi
    stack_down
    rm -rf "$WORK"
    if [ "$status" -eq 0 ]; then echo "SMOKE PASS"; else echo "SMOKE FAIL" >&2; fi
    exit "$status"
}
trap cleanup EXIT

pass() { echo "PASS: $*"; }

# --- 이미지 단독 검사 ---

help="$(docker run --rm "$IMAGE" --help)"
grep -q reset-password <<<"$help" || fail "--help 에 reset-password 없음"
pass "help"

filters="$(in_image ffmpeg -hide_banner -filters)"
# 각 행 두 번째 열이 필터 이름.
for f in zscale tonemap; do
    awk -v f="$f" '$2 == f { found = 1 } END { exit !found }' <<<"$filters" || fail "ffmpeg 필터 $f 없음"
done
in_image ffprobe -version >/dev/null || fail "ffprobe 실행 실패"
pass "ffmpeg zscale/tonemap, ffprobe"

# libheif 플러그인 존재와 공유 라이브러리 해석 확인. 변수는 컨테이너 셸에서 확장.
# shellcheck disable=SC2016
in_image sh -c '
    set -e
    for p in libde265 dav1d aomenc; do
        f=$(ls /usr/lib/*/libheif/plugins/libheif-$p.so)
        if ldd "$f" | grep -q "not found"; then echo "$f: missing deps"; exit 1; fi
    done
    if ldd /app/littledays | grep -q "not found"; then echo "littledays: missing deps"; exit 1; fi
' || fail "libheif 플러그인 또는 바이너리 의존성"
pass "libheif plugins, binary deps"

# --- compose 기동 ---

stack_write

# root 소유 기존 파일. 재귀 chown 확인용.
docker run --rm --entrypoint sh -v "$WORK/data:/data" "$IMAGE" \
    -c 'mkdir -p /data/originals/2026 && touch /data/originals/2026/seed'

compose up -d --quiet-pull
wait_healthy
pass "/api/health 200"

headers="$(curl -fsS -D - -o /dev/null "$BASE/")" || fail "/ 200 아님"
grep -qi '^content-security-policy:' <<<"$headers" || fail "/ 에 content-security-policy 헤더 없음"
pass "/ 200 + content-security-policy"

# puid_owns_written_files: 기동 시 chown(기존 트리)과 서버가 만든 디렉터리 모두 PUID 소유.
for path in /data /data/originals /data/originals/2026/seed /data/tmp/uploads /proc/1; do
    owner="$(compose exec -T app stat -c %u "$path")"
    [ "$owner" = "$PUID" ] || fail "$path 소유자 $owner (기대 $PUID)"
done
pass "puid_owns_written_files"

logs="$(compose logs --no-color --no-log-prefix app)"
head -n 1 <<<"$logs" | grep -q '^{' || fail "로그가 JSON 아님"
if grep -q -e 'not usable' -e 'lacks zscale' <<<"$logs"; then
    fail "기동 시 도구 경고"
fi
pass "JSON 로그, 도구 경고 없음"

set +e
out="$(compose run --rm --no-deps -T app reset-password smoke-nobody 2>&1)"
code=$?
set -e
[ "$code" -eq 1 ] || fail "reset-password 없는 사용자 종료 코드 $code (기대 1): $out"
grep -q 'user not found' <<<"$out" || fail "reset-password 출력: $out"
pass "reset-password 없는 사용자 종료 코드 1"

# 이미 PUID 소유인 트리로 재기동. SIGTERM 이 서버까지 전달되면 즉시 종료.
start=$SECONDS
compose restart app >/dev/null
stop_secs=$((SECONDS - start))
[ "$stop_secs" -lt 15 ] || fail "재시작 ${stop_secs}초. SIGTERM 전달 확인 필요"
wait_healthy
pass "재시작 ${stop_secs}초 후 /api/health 200"

# containerd 이미지 저장소면 DISK USAGE(압축 해제), CONTENT SIZE(압축) 둘 다 표시.
docker image ls "$IMAGE"
