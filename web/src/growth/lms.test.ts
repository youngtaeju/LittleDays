import { describe, expect, it } from 'vitest'
import { PERCENTILE_Z, curves, lmsValue } from './lms'

function at(sex: 'male' | 'female', kind: 'height' | 'weight', month: number) {
  const p = curves(sex, kind).find((c) => c.month === month)
  if (!p) throw new Error(`${String(month)}개월 없음`)
  return p
}

describe('lms', () => {
  // 기대값 출처: WHO 확장 백분위 표(Expanded tables, percentiles).
  // wfa-boys-percentiles-expanded-tables.xlsx, Age 365(12개월) P3 7.844, P50 9.646, P97 11.830
  // 같은 표 Age 731(24개월, round(730.5)) P3 9.807, P97 15.074, Age 1826(60개월) P3 14.287, P97 23.761
  // lhfa-girls-percentiles-expanded-tables.xlsx, Age 731(24개월, 선 키) P3 79.661, P97 91.799
  it('lms_matches_who', () => {
    const m12 = at('male', 'weight', 12)
    expect(m12.p50).toBeCloseTo(9.646, 3)
    expect(Math.abs(m12.p3 - 7.844)).toBeLessThanOrEqual(0.05)
    expect(Math.abs(m12.p97 - 11.83)).toBeLessThanOrEqual(0.05)

    const m24 = at('male', 'weight', 24)
    expect(Math.abs(m24.p3 - 9.807)).toBeLessThanOrEqual(0.05)
    expect(Math.abs(m24.p97 - 15.074)).toBeLessThanOrEqual(0.05)

    const m60 = at('male', 'weight', 60)
    expect(Math.abs(m60.p3 - 14.287)).toBeLessThanOrEqual(0.05)
    expect(Math.abs(m60.p97 - 23.761)).toBeLessThanOrEqual(0.05)

    const g24 = at('female', 'height', 24)
    expect(Math.abs(g24.p3 - 79.661)).toBeLessThanOrEqual(0.05)
    expect(Math.abs(g24.p97 - 91.799)).toBeLessThanOrEqual(0.05)

    // 0~60개월 월 단위, 백분위 순서 유지.
    for (const sex of ['male', 'female'] as const) {
      for (const kind of ['height', 'weight'] as const) {
        const c = curves(sex, kind)
        expect(c.map((p) => p.month)).toEqual(
          Array.from({ length: 61 }, (_, i) => i),
        )
        for (const p of c) {
          expect(p.p3).toBeLessThan(p.p15)
          expect(p.p15).toBeLessThan(p.p50)
          expect(p.p50).toBeLessThan(p.p85)
          expect(p.p85).toBeLessThan(p.p97)
        }
      }
    }
  })

  it('l_zero_formula', () => {
    expect(lmsValue(0, 10, 0.1, 1)).toBeCloseTo(10 * Math.exp(0.1), 10)
    expect(lmsValue(0, 10, 0.1, PERCENTILE_Z[50])).toBe(10)
    // L=1 이면 정규분포(M + M*S*z).
    expect(lmsValue(1, 50, 0.04, 2)).toBeCloseTo(54, 10)
    expect(lmsValue(0.5, 10, 0.1, PERCENTILE_Z[50])).toBeCloseTo(10, 10)
  })
})
