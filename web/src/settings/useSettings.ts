import { useQuery } from '@tanstack/react-query'
import { api, call } from '@/api/client'
import type { Settings } from '@/api/types'
import { todayInZone } from '@/viewer/zoned'

export const settingsQueryKey = ['settings'] as const

export function useSettings(): Settings | undefined {
  const { data } = useQuery({
    queryKey: settingsQueryKey,
    queryFn: () => call(api.GET('/api/settings')),
    staleTime: 5 * 60_000,
  })
  return data
}

// 인스턴스 시간대 오늘(YYYY-MM-DD). 설정 조회 전은 브라우저 시간대.
export function useToday(): string {
  const tz = useSettings()?.timezone
  return todayInZone(tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone)
}
