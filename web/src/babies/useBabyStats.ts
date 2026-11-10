import { queryOptions, useQuery } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { api, call } from '@/api/client'
import type { AgeMonth, BabyStats } from '@/api/types'

// ['days'] 접두: 자산 변경(업로드·휴지통·태그·촬영일) 무효화 공유. 아기 수정은 babyStatsPrefix 로 따로.
export const babyStatsPrefix = ['days', 'baby-stats'] as const

export function babyStatsQuery(id: string) {
  return queryOptions({
    queryKey: [...babyStatsPrefix, id] as const,
    queryFn: () =>
      call(api.GET('/api/babies/{id}/stats', { params: { path: { id } } })),
  })
}

export function useBabyStats(id: string) {
  return useQuery(babyStatsQuery(id))
}

// 주소 조각: 생후 개월 정수, 생일 전은 before.
export function ageParam(ageMonth: number): string {
  return ageMonth < 0 ? 'before' : String(ageMonth)
}

// 주소 조각 → 개월 수. 앞자리 0·음수·소수는 무효.
export function parseAgeParam(v: string): number | null {
  if (v === 'before') return -1
  return /^(0|[1-9]\d{0,3})$/.test(v) ? Number(v) : null
}

export function findAgeMonth(
  stats: BabyStats,
  ageMonth: number,
): AgeMonth | undefined {
  return stats.age_months.find((m) => m.age_month === ageMonth)
}

export function ageMonthLabel(t: TFunction, ageMonth: number): string {
  if (ageMonth < 0) return t('babies.beforeBirth')
  if (ageMonth === 0) return t('babies.firstMonth')
  return t('babies.month', { count: ageMonth })
}
