import type { CSSProperties } from 'react'
import type { Baby } from '@/api/types'

export type AvatarCrop = NonNullable<Baby['avatar_crop']>

// 원(px) 안에 자르기 영역이 꽉 차도록 이미지 전체를 키워 옮기는 위치·크기.
// w·h: 회전 적용 후 원본 크기. 영역 한 변 = 짧은 변 × size.
export function cropStyle(
  crop: AvatarCrop,
  w: number,
  h: number,
  px: number,
): CSSProperties {
  const scale = px / (crop.size * Math.min(w, h))
  return {
    position: 'absolute',
    width: w * scale,
    height: h * scale,
    left: -crop.x * w * scale,
    top: -crop.y * h * scale,
    maxWidth: 'none',
  }
}

// 자르기 화면 확대 상한. size 하한 = 1 / MAX_ZOOM.
export const MAX_ZOOM = 4

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

// 가운데 가장 큰 정사각.
export function centerCrop(w: number, h: number): AvatarCrop {
  const side = Math.min(w, h)
  return { x: (w - side) / 2 / w, y: (h - side) / 2 / h, size: 1 }
}

// size [1/MAX_ZOOM, 1], 영역은 이미지 안(서버 검증 조건).
export function clampCrop(c: AvatarCrop, w: number, h: number): AvatarCrop {
  const size = clamp(c.size, 1 / MAX_ZOOM, 1)
  const side = size * Math.min(w, h)
  return {
    x: clamp(c.x, 0, (w - side) / w),
    y: clamp(c.y, 0, (h - side) / h),
    size,
  }
}

// 사진을 화면에서 dx·dy(px) 끌기. 영역은 반대로 이동. px: 원 지름.
export function panCrop(
  c: AvatarCrop,
  dx: number,
  dy: number,
  w: number,
  h: number,
  px: number,
): AvatarCrop {
  const perPx = (c.size * Math.min(w, h)) / px
  return clampCrop(
    { ...c, x: c.x - (dx * perPx) / w, y: c.y - (dy * perPx) / h },
    w,
    h,
  )
}

// 배율(1/size) 변경. 원 가운데 고정.
export function zoomCrop(
  c: AvatarCrop,
  zoom: number,
  w: number,
  h: number,
): AvatarCrop {
  const short = Math.min(w, h)
  const half = (c.size * short) / 2
  const size = clamp(1 / zoom, 1 / MAX_ZOOM, 1)
  const nextHalf = (size * short) / 2
  return clampCrop(
    {
      x: (c.x * w + half - nextHalf) / w,
      y: (c.y * h + half - nextHalf) / h,
      size,
    },
    w,
    h,
  )
}
