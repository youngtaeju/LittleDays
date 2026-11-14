import type { Baby } from '@/api/types'
import { useSettingsQuery } from '@/settings/useSettings'
import { useBabies } from '@/timeline/useBabies'

// 홈과 달력의 일수 기준. 목록(표시 순서)에서 설정한 아기, 없거나 지워졌으면 첫째.
export function primaryBaby<T extends { id: string }>(
  babies: T[],
  primaryId: string | null | undefined,
): T | undefined {
  return babies.find((b) => b.id === primaryId) ?? babies[0]
}

// 아기 목록 또는 설정 조회 전이면 없음(첫째로 그렸다 바뀌는 깜빡임 방지). 설정 조회 실패면 첫째.
export function usePrimaryBaby(): Baby | undefined {
  const babies = useBabies().data
  const settings = useSettingsQuery()
  if (!babies || (!settings.data && !settings.isError)) return undefined
  return primaryBaby(babies, settings.data?.primary_baby_id)
}
