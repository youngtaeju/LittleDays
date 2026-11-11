import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
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

// 날짜 바뀜 확인 주기(ms). 백그라운드 탭 타이머 지연에도 복귀 직후 갱신.
const TODAY_CHECK_MS = 60_000

// 인스턴스 시간대 오늘(YYYY-MM-DD). 설정 조회 전은 브라우저 시간대. 자정 넘으면 갱신.
export function useToday(): string {
  const tz =
    useSettings()?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const today = todayInZone(tz)
  // 같은 값이면 리렌더 없음. 날짜가 바뀔 때만 다시 그림.
  const [, setChecked] = useState(today)
  useEffect(() => {
    const id = window.setInterval(() => {
      setChecked(todayInZone(tz))
    }, TODAY_CHECK_MS)
    return () => {
      window.clearInterval(id)
    }
  }, [tz])
  return today
}
