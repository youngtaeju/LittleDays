# 릴리스

릴리스는 `vX.Y.Z` 태그를 push 하면 GitHub Actions(`.github/workflows/release.yml`)가 이미지 빌드부터 GitHub Release 생성까지 처리합니다.

## 버전 올리기

1. `server/Cargo.toml` 의 `version` 과 `web/package.json` 의 `version` 을 같은 값으로 올립니다.
2. `cd server && cargo update --workspace` 로 `Cargo.lock` 의 `littledays` 버전을 갱신하고 함께 커밋합니다. 다른 크레이트는 바뀌지 않습니다.
3. OpenAPI 문서에 버전이 들어가므로 `cd server && cargo run -q -- openapi > ../web/openapi.json` 으로 다시 만들고 함께 커밋합니다. 빠뜨리면 CI 의 OpenAPI 신선도 검사가 실패합니다.
4. PR 로 main 에 병합합니다.

## 태그 push

태그를 만들기 전에 해당 커밋이 main 에 있고, main 의 CI(server, web, docker, e2e)가 모두 통과했는지 확인합니다.

```sh
git switch main && git pull
git tag vX.Y.Z
git push origin vX.Y.Z
```

태그는 반드시 `server/Cargo.toml` 의 버전과 일치해야 합니다. 다르면 워크플로가 이미지를 만들기 전에 실패합니다.

`latest` 는 가장 마지막에 push 된 릴리스를 가리킵니다. 더 새로운 버전 뒤에 이전 버전 태그(백포트)를 push 하면 `latest` 가 이전 버전으로 되돌아갑니다.

## 워크플로가 하는 일

1. 태그 형식(`vX.Y.Z`)과 `server/Cargo.toml` 버전 일치 검사
2. `docker/Dockerfile` 로 `linux/amd64` 이미지를 빌드하고 `docker/smoke.sh` 로 스모크 검사. 실패하면 push 하지 않습니다.
3. `ghcr.io/youngtaeju/littledays` 에 `X.Y.Z`, `X.Y`, `latest` 태그로 push (OCI 라벨: source, version, licenses=AGPL-3.0-only)
4. 생성된 릴리스 노트로 GitHub Release 생성

## 릴리스 전 수동 확인

자동 테스트가 확인하지 못하는 항목입니다. 실제 배포 환경(https 리버스 프록시 뒤)에서 확인합니다.

태그를 만들기 전이라 레지스트리에 이미지가 없으므로, 릴리스 대상 커밋에서 이미지를 로컬로 빌드해 사용합니다.

```sh
docker build -f docker/Dockerfile -t littledays:dev .
```

compose 는 이미지를 `ghcr.io/youngtaeju/littledays:${LITTLEDAYS_VERSION:-latest}` 로 참조합니다. 로컬 이미지를 쓰려면 같은 이름으로 태그를 붙이고 `LITTLEDAYS_VERSION` 을 그 태그로 지정합니다(`.env` 의 값 또는 환경 변수).

```sh
docker tag littledays:dev ghcr.io/youngtaeju/littledays:local
LITTLEDAYS_VERSION=local docker compose up -d --pull never
```

업데이트 안내 흐름은 이전 버전 이미지가 필요합니다. 이전 커밋(첫 릴리스라면 main 의 더 앞선 커밋)을 체크아웃해 같은 방법으로 `local-old` 같은 태그로 빌드하고, 먼저 그 이미지로 기동해 PWA 를 설치한 뒤 새 이미지(`local`)로 교체합니다.

- [ ] 안드로이드 Chrome 과 iOS Safari 에서 https 로 접속해 PWA 설치
- [ ] 업데이트 안내 흐름: 이전 버전을 설치한 상태에서 새 이미지로 교체 후 안내 표시, 새로고침하면 새 버전으로 동작
- [ ] iOS 사진 보관함에서 고른 파일의 이어올리기(업로드 중 새로고침 후 같은 파일 재선택)
- [ ] EXIF 없는 파일의 촬영일: `File.lastModified` 가 촬영 시각이 아니라 사진을 고른 시각으로 오는지 확인하고, 그렇다면 알려진 제약으로 기록
- [ ] 실제 사진 일괄 업로드(수백 장): EXIF 없는 파일의 촬영일이 파일 수정시각(원본 보존 여부) 기준으로 맞는지, 처리 완료까지의 시간과 메모리 사용량
- [ ] 브라우저 콘솔에 CSP 위반이 0건인지 확인(리버스 프록시 뒤의 실제 배포에서)
- [ ] Safari/iOS 에서 앱 테마 선택에 맞춰 `theme-color` 가 바뀌는지 확인
- [ ] README 의 서드파티 라이선스 안내가 이번 릴리스에도 정확한지 확인. 이미지에 포함된 Debian ffmpeg 는 GPL 구성요소(x264, x265 등)를 링크합니다.

## 첫 push 후 확인

- GHCR 패키지는 처음 push 하면 비공개일 수 있습니다. 비공개이면 사용자의 `docker compose pull` 이 실패하므로, 패키지 설정(Package settings)의 가시성(visibility)을 public 으로 바꿉니다.
- 패키지가 이 저장소에 연결되어 있지 않으면 연결(Connect repository)합니다.
- 패키지를 public 으로 바꾸면 다시 private 으로 되돌릴 수 없습니다. 공개 전환 시점을 확인한 뒤 바꿉니다.
- 로그인하지 않은 환경에서 `docker pull ghcr.io/youngtaeju/littledays:latest` 가 되는지 확인합니다.
- push 가 403 `write_package` 로 실패하면 같은 이름의 패키지가 이미 있고 이 저장소의 Actions 에 쓰기 권한이 없는 경우입니다. 패키지 설정에서 이 저장소의 Actions 에 쓰기 권한을 부여합니다.
