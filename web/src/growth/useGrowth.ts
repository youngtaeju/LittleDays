import { queryOptions, useQuery } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { api, call } from '@/api/client'
import type { Baby, GrowthRecord } from '@/api/types'
import { hasRole, useMe } from '@/auth/session'
import { useToday } from '@/settings/useSettings'

// 아기별 성장 기록. 쓰기, 고치기, 지우기 뒤 재조회 대상.
export function growthKey(babyId: string) {
  return ['growth', babyId] as const
}

// 서버 정렬(잰 날 오름차순).
export function growthQuery(babyId: string) {
  return queryOptions({
    queryKey: growthKey(babyId),
    queryFn: () =>
      call(
        api.GET('/api/babies/{id}/growth', {
          params: { path: { id: babyId } },
        }),
      ),
  })
}

export function useGrowth(babyId: string) {
  return useQuery(growthQuery(babyId))
}

// 태어난 아기만 기록 가능(잰 날 범위가 생일 ~ 오늘).
export function isBorn(baby: Pick<Baby, 'birth_date'>, today: string): boolean {
  return baby.birth_date <= today
}

// 성장 기록 쓰기 권한. 보호자 이상, 태어난 아기.
export function useCanRecord(baby: Baby): boolean {
  const { user } = useMe()
  const today = useToday()
  return hasRole(user, 'guardian') && isBorn(baby, today)
}

const numberFormats = new Map<string, Intl.NumberFormat>()

// 키 소수 1자리, 몸무게 소수 2자리까지(끝 0 생략). 단위 포함.
export function formatMeasure(
  t: TFunction,
  lng: string,
  kind: 'height' | 'weight',
  v: number,
): string {
  const digits = kind === 'height' ? 1 : 2
  const key = `${lng}:${String(digits)}`
  let f = numberFormats.get(key)
  if (!f) {
    f = new Intl.NumberFormat(lng, { maximumFractionDigits: digits })
    numberFormats.set(key, f)
  }
  const value = f.format(v)
  return kind === 'height'
    ? t('growth.heightValue', { value })
    : t('growth.weightValue', { value })
}

// 키와 몸무게 표시 문구. 둘 중 있는 값만.
export function formatValues(
  t: TFunction,
  lng: string,
  r: Pick<GrowthRecord, 'height_cm' | 'weight_kg'>,
): string {
  const height =
    r.height_cm === null ? null : formatMeasure(t, lng, 'height', r.height_cm)
  const weight =
    r.weight_kg === null ? null : formatMeasure(t, lng, 'weight', r.weight_kg)
  if (height && weight) return t('growth.values', { height, weight })
  return height ?? weight ?? ''
}
