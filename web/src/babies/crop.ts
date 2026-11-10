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
