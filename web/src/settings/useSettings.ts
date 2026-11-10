import { useQuery } from '@tanstack/react-query'
import { api, call } from '@/api/client'
import type { Settings } from '@/api/types'
import { todayInZone } from '@/viewer/zoned'

export const settingsQueryKey = ['settings'] as const

const INSTANCE_NAME_KEY = 'ld.instance.name'

// 로그인 전 화면 제목용. 마지막으로 본 우리 집 이름(기기 저장).
export function rememberedInstanceName(): string | null {
  try {
    return localStorage.getItem(INSTANCE_NAME_KEY)
  } catch {
    return null
  }
}

function rememberInstanceName(name: string): void {
  try {
    localStorage.setItem(INSTANCE_NAME_KEY, name)
  } catch {
    // 저장 실패 시 다음 방문에 기본 제목.
  }
}

export function useSettingsQuery() {
  return useQuery({
    queryKey: settingsQueryKey,
    queryFn: async () => {
      const settings = await call(api.GET('/api/settings'))
      rememberInstanceName(settings.instance_name)
      return settings
    },
    staleTime: 5 * 60_000,
  })
}

export function useSettings(): Settings | undefined {
  return useSettingsQuery().data
}

// 인스턴스 시간대 오늘(YYYY-MM-DD). 설정 조회 전은 브라우저 시간대.
export function useToday(): string {
  const tz = useSettings()?.timezone
  return todayInZone(tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone)
}
