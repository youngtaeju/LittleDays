import { describe, expect, it } from 'vitest'
import { cropStyle } from './crop'

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
