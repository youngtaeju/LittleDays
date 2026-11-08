# 운영 안내

Docker Compose 로 설치한 LittleDays 를 운영할 때의 안내입니다. 설치와 업그레이드는 [README](../README.md) 를 참고하십시오. 아래 명령은 `docker-compose.yml` 이 있는 디렉터리에서 실행하며, 서비스 이름은 `app`(애플리케이션)과 `postgres` 입니다.

## 리버스 프록시와 https

휴대폰에서 PWA 를 설치하고 서비스 워커를 동작시키려면 https 가 필요합니다(localhost 는 예외). 외부에서 접속하려면 리버스 프록시로 https 를 종단하고, `.env` 의 `PUBLIC_URL` 을 그 https 주소로 설정합니다. 프록시가 같은 호스트에 있다면 compose 의 `ports` 를 `127.0.0.1:${PORT:-8080}:8080` 으로 바꿔 외부 노출을 막습니다.

업로드는 8 MiB 단위 조각(tus)으로 전송되므로 요청 본문 상한은 16 MB 이상이면 충분합니다. 큰 영상은 업로드 완료(finalize) 시 서버가 해시를 계산하느라 응답이 오래 걸릴 수 있으므로 읽기 타임아웃을 넉넉하게 둡니다.

### nginx

```nginx
server {
    listen 443 ssl;
    server_name littledays.example.com;

    # ssl_certificate, ssl_certificate_key 설정은 생략

    client_max_body_size 16m;
    client_body_timeout 300s;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_request_buffering off;
        proxy_read_timeout 300s;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
    }
}
```

### Caddy

Caddy 는 https 인증서를 자동으로 발급하며 `X-Forwarded-*` 헤더도 기본으로 설정합니다.

```caddyfile
littledays.example.com {
    reverse_proxy 127.0.0.1:8080 {
        transport http {
            read_timeout 300s
        }
    }
}
```

### Cloudflare Tunnel

Cloudflare Tunnel 은 요청당 응답 대기 시간이 100초로 제한됩니다. 용량이 큰 영상의 finalize 가 이 제한을 넘기면 실패할 수 있으므로, 큰 영상을 자주 올린다면 Tunnel 대신 다른 방식을 권장합니다. 사진 위주라면 대체로 문제가 없습니다.

`PUBLIC_URL` 이 https 이면 세션 쿠키가 Secure 로 설정되므로, LAN 에서 `http://nas:8080` 같은 http 주소로 접속하면 로그인이 오류 표시 없이 실패합니다. 항상 https 주소로 접속하십시오.

## 데이터 디렉터리

컨테이너의 `DATA_DIR` 은 `/data` 이며 호스트의 `./data` 에 연결됩니다. 하위 디렉터리는 다음과 같습니다.

| 디렉터리 | 내용 |
| --- | --- |
| `originals/` | 업로드한 원본 파일. 바이트 그대로 보존하며, 휴지통에서 영구 삭제된 항목(직접 삭제하거나 보관 기간이 지난 항목) 외에는 원본을 삭제하지 않습니다. |
| `derivatives/` | 썸네일, 변환본, 포스터 등 파생물. 현재 일괄 재생성 수단이 없으므로 백업 대상입니다. |
| `tmp/` | 업로드 중인 임시 파일 |
| `orphans/` | DB 에 기록이 없는 고아 원본(아래 참조) |

`DATA_DIR` 은 하나의 파일시스템 안에 있어야 합니다. 서버가 파일을 `rename` 으로 옮기므로, 하위 디렉터리를 서로 다른 볼륨이나 마운트로 나누면 동작하지 않습니다.

`./data` 의 소유자는 `PUID`/`PGID` 로 지정한 사용자입니다. 컨테이너는 시작할 때 소유권을 맞춘 뒤 해당 사용자로 서버를 실행합니다.

### 고아 원본(`orphans/`)

서버는 한 시간마다 정리 작업을 수행합니다. 이때 DB 에 행이 없는 원본 파일 중 24시간이 지난 것을 `DATA_DIR/orphans/originals/YYYY/MM/` 으로 옮깁니다. 크래시 등으로 업로드가 중단되었을 때, 또는 파일보다 오래된 DB 를 복원했을 때 생길 수 있습니다. 파일을 삭제하지는 않으며, assets 테이블이 비어 있으면 이 작업을 건너뜁니다. 사진이 아직 없는 새 설치에서는 정리 작업이 `assets table is empty, skipping derivatives and originals sweep` WARN 로그를 남기는데, 정상입니다.

`orphans/` 의 파일은 직접 확인한 뒤 필요 없으면 삭제하십시오. 소중한 사진이 있다면 다시 업로드해 복구할 수 있습니다.

## 메모리

이미지 처리는 원본 해상도로 디코드하므로 해상도에 비례해 메모리를 씁니다(릴리스 빌드 측정값, 사진 1장 처리 기준).

| 해상도 | 최대 메모리 |
| --- | --- |
| 48 MP | 약 300 MB |
| 200 MP (JPEG/PNG) | 약 0.74 GB |
| 200 MP, EXIF 방향에 따라 90도 회전이 필요한 경우 | 약 1.18 GB |

210,000,000 픽셀(200 MP 급)을 넘는 이미지는 디코드 전에 거부되어 해당 항목이 `failed` 상태가 됩니다.

동시에 처리하는 작업 수는 `WORKER_CONCURRENCY`(1~16, 기본 2)로 조절합니다. 초대형 이미지 두 장을 동시에 처리하면 약 2.4~3 GB 가 필요할 수 있으므로, 메모리 2~4 GB 의 NAS 에서는 `1` 또는 `2` 를 권장합니다.

영상은 ffprobe/ffmpeg 하위 프로세스로 처리하며 시간 제한이 있습니다(분석 30초, 포스터 60초, 재포장 120초 + 영상 길이, 변환 300초 + 영상 길이의 4배). 제한을 넘기면 해당 항목이 `failed` 가 됩니다. 색 태그(transfer, primaries, matrix)가 모두 있는 HDR(HLG/PQ) 영상은 SDR 로 톤매핑하고, 태그가 불완전한 영상은 톤매핑 없이 변환합니다.

## 백업

필수 백업 대상은 두 가지입니다.

- 데이터베이스: `pg_dump`
- 데이터 디렉터리 전체: `./data` (`tmp/` 는 제외해도 됩니다)

`derivatives/` 도 백업해야 합니다. 현재는 파생물을 일괄 재생성하는 수단이 없습니다. DB 와 `originals/` 만 복원하면 모든 항목이 `ready` 상태로 남지만 썸네일과 변환본은 404 가 됩니다.

```bash
docker compose exec -T postgres pg_dump -U littledays littledays | gzip > littledays-$(date +%F).sql.gz
rsync -a --exclude tmp/ ./data/ /path/to/backup/data/
```

두 백업은 가능하면 같은 시점에 받으십시오. 업그레이드 전에도 백업해 두는 것을 권장합니다.

### 복원

이미 마이그레이션된 DB 에 덤프를 적용하면 오류가 나므로, 새(빈) postgres 디렉터리(`./postgres`)에 복원합니다. 순서는 다음과 같습니다.

```bash
docker compose up -d postgres
gunzip -c littledays-YYYY-MM-DD.sql.gz | docker compose exec -T postgres psql -U littledays littledays
rsync -a /path/to/backup/data/ ./data/
docker compose up -d
```

## 계정 복구

소유자가 비밀번호를 잃어버렸을 때(이메일 발송 기능이 없습니다) 서버에서 새 비밀번호를 발급합니다.

```bash
docker compose exec app /app/littledays reset-password <username>
```

새 비밀번호가 출력되고, 해당 사용자의 기존 세션은 모두 로그아웃됩니다. 이 명령은 DB 만 사용하므로 컨테이너의 환경 변수만으로 동작합니다. 로그인한 뒤 비밀번호를 바꾸십시오.

## 로그

이미지는 JSON 형식 로그를 stderr 로 출력합니다(`LOG_FORMAT=json`).

```bash
docker compose logs -f app
```

로그 수준은 `.env` 의 `RUST_LOG`(기본 `info`)로 조절합니다. 토큰과 쿼리 문자열은 기록하지 않습니다.
