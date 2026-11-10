import { describe, expect, it } from 'vitest'
import {
  centerCrop,
  clampCrop,
  cropStyle,
  panCrop,
  zoomCrop,
  type AvatarCrop,
} from './crop'

// 서버 검증(fits)과 같은 조건.
function expectFits(c: AvatarCrop, w: number, h: number) {
  const side = c.size * Math.min(w, h)
  expect(c.size).toBeGreaterThan(0)
  expect(c.size).toBeLessThanOrEqual(1)
  expect(c.x).toBeGreaterThanOrEqual(0)
  expect(c.y).toBeGreaterThanOrEqual(0)
  expect(c.x * w + side).toBeLessThanOrEqual(w + 1e-6)
  expect(c.y * h + side).toBeLessThanOrEqual(h + 1e-6)
}

describe('cropStyle', () => {
  it('crop_style_math', () => {
    const s = cropStyle({ x: 0.25, y: 0.1, size: 0.5 }, 4000, 3000, 72)
    expect(s.width).toBeCloseTo(192)
    expect(s.height).toBeCloseTo(144)
    expect(s.left).toBeCloseTo(-48)
    expect(s.top).toBeCloseTo(-14.4)
  })

  it('portrait_uses_width_as_short_side', () => {
    // 3000×4000, 한 변 = 3000 × 1 → 이미지 폭이 원과 같음.
    const s = cropStyle({ x: 0, y: 0.25, size: 1 }, 3000, 4000, 100)
    expect(s.width).toBeCloseTo(100)
    expect(s.height).toBeCloseTo(133.333)
    expect(s.left).toBeCloseTo(0)
    expect(s.top).toBeCloseTo(-33.333)
  })
})

describe('crop inverse', () => {
  it('center_crop_landscape_and_portrait', () => {
    expect(centerCrop(4000, 3000)).toEqual({ x: 0.125, y: 0, size: 1 })
    expect(centerCrop(3000, 4000)).toEqual({ x: 0, y: 0.125, size: 1 })
    expect(centerCrop(500, 500)).toEqual({ x: 0, y: 0, size: 1 })
  })

  it('clamp_keeps_square_inside_all_edges', () => {
    for (const [w, h] of [
      [4000, 3000],
      [3000, 4000],
    ] as const) {
      for (const c of [
        { x: -1, y: -1, size: 0.5 },
        { x: 2, y: 2, size: 0.5 },
        { x: 0.9, y: -0.2, size: 0.3 },
        { x: -0.2, y: 0.9, size: 0.3 },
        { x: 0.5, y: 0.5, size: 5 },
        { x: 0.5, y: 0.5, size: 0 },
      ]) {
        expectFits(clampCrop(c, w, h), w, h)
      }
    }
    // 오른쪽 아래 끝. 4000×3000, 한 변 1500.
    expect(clampCrop({ x: 1, y: 1, size: 0.5 }, 4000, 3000)).toEqual({
      x: 2500 / 4000,
      y: 0.5,
      size: 0.5,
    })
    // 최대 4배.
    expect(clampCrop({ x: 0, y: 0, size: 0.1 }, 4000, 3000).size).toBe(0.25)
  })

  it('pan_moves_opposite_to_drag_in_source_pixels', () => {
    // 4000×3000, size 0.5 → 한 변 1500, 원 300px → 화면 1px = 원본 5px.
    const c = { x: 0.25, y: 0.25, size: 0.5 }
    const moved = panCrop(c, 30, -60, 4000, 3000, 300)
    expect(moved.x).toBeCloseTo(0.25 - 150 / 4000)
    expect(moved.y).toBeCloseTo(0.25 + 300 / 3000)
    expect(moved.size).toBe(0.5)
  })

  it('pan_far_stays_inside', () => {
    for (const [w, h] of [
      [4000, 3000],
      [3000, 4000],
    ] as const) {
      const c = zoomCrop(centerCrop(w, h), 2, w, h)
      for (const [dx, dy] of [
        [10000, 0],
        [-10000, 0],
        [0, 10000],
        [0, -10000],
        [10000, 10000],
        [-10000, -10000],
      ] as const) {
        expectFits(panCrop(c, dx, dy, w, h, 256), w, h)
      }
      // 사진을 오른쪽 아래로 끝까지 → 영역은 왼쪽 위 모서리.
      expect(panCrop(c, 10000, 10000, w, h, 256)).toMatchObject({ x: 0, y: 0 })
    }
  })

  it('zoom_keeps_center_and_clamps', () => {
    const c = centerCrop(4000, 3000)
    const z = zoomCrop(c, 2, 4000, 3000)
    expect(z.size).toBe(0.5)
    // 가운데 (2000, 1500) 유지.
    expect(z.x * 4000 + (z.size * 3000) / 2).toBeCloseTo(2000)
    expect(z.y * 3000 + (z.size * 3000) / 2).toBeCloseTo(1500)
    // 모서리에서 축소해도 이미지 안.
    const corner = { x: 0.75, y: 0.75, size: 0.25 }
    expectFits(
      zoomCrop(clampCrop(corner, 4000, 3000), 1, 4000, 3000),
      4000,
      3000,
    )
    expect(zoomCrop(c, 10, 4000, 3000).size).toBe(0.25)
    expect(zoomCrop(c, 0.5, 4000, 3000).size).toBe(1)
  })
})
