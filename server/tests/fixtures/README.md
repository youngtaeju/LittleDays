# 테스트 fixture

이미지 처리 테스트(`tests/media_image.rs`)용 합성 이미지입니다. 개인 사진은 넣지 않습니다.

| 파일 | 내용 |
|---|---|
| `orient6.jpg` | 320x240 대각 그라디언트(왼쪽 위 빨강 → 오른쪽 아래 파랑). EXIF Orientation 6, DateTimeOriginal `2024:05:01 10:20:30`(오프셋 없음), Make `TestMake`, Model `TestModel`, GPS 37.5665 N 126.9780 E |
| `offset.jpg` | 64x48 단색. DateTimeOriginal `2024:05:01 10:20:30`, OffsetTimeOriginal `+02:00` |
| `plain.png` | 300x200 그라디언트. EXIF 없음 |
| `p3.jpg` | 64x64 단색 RGB(200, 60, 60), Display P3 ICC(libvips 내장 `p3`, 480 바이트) 내장. 픽셀 값은 변환 없이 P3 값으로 해석됨 |
| `rotated.heic` | `orient6.jpg` 를 `heif-enc` 로 인코드. irot(270 ccw) 와 EXIF Orientation 6 을 함께 보유 |

## 생성

이 디렉터리에서 실행합니다. `heif-enc` 의 HEVC 인코더(`libheif-plugin-x265`)가 Recommends 로 설치되므로 `--no-install-recommends` 를 쓰지 않습니다.

```bash
docker build -t littledays-fixtures - <<'EOF'
FROM debian:trixie-slim
RUN apt-get update && apt-get install -y imagemagick libimage-exiftool-perl libheif-examples libvips-tools
EOF

docker run --rm -i -u "$(id -u):$(id -g)" -v "$PWD":/work -w /work littledays-fixtures sh -s <<'EOF'
set -e
magick -size 320x240 -define gradient:direction=SouthEast gradient:red-blue -depth 8 -strip -quality 90 orient6.jpg
exiftool -q -overwrite_original -Orientation#=6 '-DateTimeOriginal=2024:05:01 10:20:30' -Make=TestMake -Model=TestModel -GPSLatitude=37.5665 -GPSLatitudeRef=N -GPSLongitude=126.9780 -GPSLongitudeRef=E orient6.jpg
heif-enc orient6.jpg -o rotated.heic
magick -size 64x48 xc:'rgb(90,140,200)' -strip -quality 90 offset.jpg
exiftool -q -overwrite_original '-DateTimeOriginal=2024:05:01 10:20:30' -OffsetTimeOriginal=+02:00 offset.jpg
magick -size 300x200 gradient:yellow-green -depth 8 -strip plain.png
magick -size 64x64 xc:'rgb(200,60,60)' -strip -quality 95 -sampling-factor 1x1 p3.jpg
vips icc_transform p3.jpg /tmp/p3-tagged.jpg p3 --input-profile srgb
exiftool -b -ICC_Profile /tmp/p3-tagged.jpg > /tmp/p3.icc
exiftool -q -overwrite_original '-ICC_Profile<=/tmp/p3.icc' p3.jpg
EOF
```

`p3.jpg` 는 단색 JPEG 를 만든 뒤 ICC 만 붙입니다. 두 번째 `vips icc_transform` 은 P3 프로파일을 꺼내기 위한 것이며, 그 결과 픽셀은 쓰지 않습니다.

도구 버전(2026-11-07 생성): ImageMagick 7.1.1-43, ExifTool 13.25, libheif 1.23.6(x265 4.1), libvips 8.16.1. 같은 명령으로 다시 만들면 바이트 단위로 같은 파일이 나왔습니다.

## 확인 기록

같은 컨테이너에서 확인한 결과입니다.

`heif-info rotated.heic` (발췌): 표시 크기 240x320, 회전 변환 보유

```
image: 240x320 (id=1), primary
  colorspace: YCbCr, 4:2:0
metadata:
  Exif: 350 bytes
transformations:
  angle (ccw): 270
```

`exiftool -n -Orientation rotated.heic`: EXIF Orientation 도 6

```
Orientation                     : 6
```

`p3.jpg` sRGB 기준값: 중앙 픽셀 (217, 42, 52)

```
$ vips icc_transform p3.jpg out.png srgb --embedded
$ vips getpoint out.png 32 32
217 42 52
```

## 영상 fixture

영상 처리 테스트(`tests/media_video.rs`, `media/video.rs` 단위 테스트)용 합성 클립과 ffprobe 출력입니다. 호스트 ffmpeg 6.1.1(Ubuntu 24.04, libx264/libx265)로 만들었습니다. 이 디렉터리에서 실행합니다.

| 파일 | 내용 |
|---|---|
| `clip-h264.mp4` | 2초 160x120 15fps, H.264 yuv420p + AAC mono, `creation_time=2024-06-01T03:00:00Z` |
| `clip-hevc.mov` | 2초 160x120 15fps, HEVC yuv420p + AAC mono, displaymatrix 회전 90(표시 120x160), 같은 `creation_time` |
| `clip-hlg.mov` | 2초 160x120 15fps, HEVC yuv420p10le 영상만(오디오 없음), bt2020/arib-std-b67(HLG)/bt2020nc 태그. HDR 톤매핑 테스트용 |
| `probe/h264.json`, `probe/hevc-rotated.json` | 위 두 클립의 실제 `ffprobe` 출력 |
| `probe/apple-creationdate.json` | 아이폰 형태 출력을 필요한 필드만 남겨 손으로 축약한 것. `com.apple.quicktime.creationdate`(`2024-05-01T10:20:30+0900`)와 `side_data_list` rotation -90 포함. 실제 클립 없음 |

```bash
ffmpeg -v error -y -f lavfi -i testsrc2=size=160x120:rate=15:duration=2 -f lavfi -i sine=frequency=440:duration=2 \
  -c:v libx264 -pix_fmt yuv420p -preset veryfast -crf 28 -c:a aac -b:a 32k -shortest \
  -metadata creation_time=2024-06-01T03:00:00Z -movflags +faststart clip-h264.mp4

ffmpeg -v error -y -f lavfi -i testsrc2=size=160x120:rate=15:duration=2 -f lavfi -i sine=frequency=440:duration=2 \
  -c:v libx265 -tag:v hvc1 -pix_fmt yuv420p -x265-params log-level=error -crf 30 -c:a aac -b:a 32k -shortest \
  -metadata creation_time=2024-06-01T03:00:00Z -f mp4 /tmp/hevc-src.mp4
ffmpeg -v error -y -display_rotation:v 90 -i /tmp/hevc-src.mp4 -c copy \
  -metadata creation_time=2024-06-01T03:00:00Z -f mov clip-hevc.mov

ffmpeg -v error -y -f lavfi -i testsrc2=size=160x120:rate=15:duration=2 \
  -pix_fmt yuv420p10le -c:v libx265 -tag:v hvc1 -x265-params log-level=error -crf 30 \
  -color_primaries bt2020 -color_trc arib-std-b67 -colorspace bt2020nc -f mov clip-hlg.mov

ffprobe -v error -print_format json -show_format -show_streams clip-h264.mp4 > probe/h264.json
ffprobe -v error -print_format json -show_format -show_streams clip-hevc.mov > probe/hevc-rotated.json
```
