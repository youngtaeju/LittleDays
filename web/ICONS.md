# 아이콘 생성

원본은 `public/icon.svg` 하나입니다. PNG 는 `web/public/` 디렉터리로 이동한 뒤(`cd web/public`) 아래 명령으로 다시 만듭니다. 결과는 같은 디렉터리에 생깁니다.

```sh
docker run --rm -v "$PWD":/w -w /w debian:trixie-slim sh -c '
  apt-get update -qq && apt-get install -y -qq --no-install-recommends librsvg2-bin &&
  rsvg-convert -w 192 -h 192 icon.svg -o icon-192.png &&
  rsvg-convert -w 512 -h 512 icon.svg -o icon-512.png &&
  rsvg-convert -w 410 -h 410 --page-width 512 --page-height 512 --left 51 --top 51 \
    --background-color "#A85E12" icon.svg -o icon-maskable-512.png &&
  rsvg-convert -w 180 -h 180 --background-color "#A85E12" icon.svg -o apple-touch-icon.png &&
  chown '"$(id -u):$(id -g)"' *.png'
```

- maskable: 80% 크기로 가운데 배치하고 바탕을 강조색으로 채웁니다. 마크는 안전 영역(지름 80% 원) 안에 들어갑니다.
- apple-touch-icon: iOS 는 투명 영역을 검게 칠하므로 모서리까지 바탕색으로 채웁니다.
- 확인한 버전: rsvg-convert 2.60.0
