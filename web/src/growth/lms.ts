import type { Baby } from '@/api/types'
import lengthHeightBoys from './who/length-height-boys.json'
import lengthHeightGirls from './who/length-height-girls.json'
import weightBoys from './who/weight-boys.json'
import weightGirls from './who/weight-girls.json'

export type GrowthKind = 'height' | 'weight'
export type Sex = NonNullable<Baby['sex']>

interface Lms {
  month: number
  L: number
  M: number
  S: number
}

export interface CurvePoint {
  month: number
  p3: number
  p15: number
  p50: number
  p85: number
  p97: number
}

// WHO 곡선이 있는 마지막 개월(0~60개월 표).
export const CURVE_LAST_MONTH = 60

// WHO 확장 표 안내의 개월 환산(1개월 = 30.4375일).
export const DAYS_PER_MONTH = 30.4375

// 표준정규분포 백분위 z 값.
export const PERCENTILE_Z = {
  3: -1.881,
  15: -1.036,
  50: 0,
  85: 1.036,
  97: 1.881,
} as const

const TABLES: Record<Sex, Record<GrowthKind, readonly Lms[]>> = {
  male: { height: lengthHeightBoys, weight: weightBoys },
  female: { height: lengthHeightGirls, weight: weightGirls },
}

// LMS 공식. L=0 이면 로그정규 극한.
export function lmsValue(L: number, M: number, S: number, z: number): number {
  if (L === 0) return M * Math.exp(S * z)
  return M * Math.pow(1 + L * S * z, 1 / L)
}

const cache = new Map<string, CurvePoint[]>()

// 0~60개월 월 단위 3/15/50/85/97 백분위 값.
export function curves(sex: Sex, kind: GrowthKind): CurvePoint[] {
  const key = `${sex}:${kind}`
  let out = cache.get(key)
  if (!out) {
    out = TABLES[sex][kind].map(({ month, L, M, S }) => ({
      month,
      p3: lmsValue(L, M, S, PERCENTILE_Z[3]),
      p15: lmsValue(L, M, S, PERCENTILE_Z[15]),
      p50: lmsValue(L, M, S, PERCENTILE_Z[50]),
      p85: lmsValue(L, M, S, PERCENTILE_Z[85]),
      p97: lmsValue(L, M, S, PERCENTILE_Z[97]),
    }))
    cache.set(key, out)
  }
  return out
}
