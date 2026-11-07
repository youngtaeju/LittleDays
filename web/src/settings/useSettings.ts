import { useQuery } from '@tanstack/react-query'
import { api, call } from '@/api/client'
import type { Settings } from '@/api/types'

export const settingsQueryKey = ['settings'] as const

export function useSettings(): Settings | undefined {
  const { data } = useQuery({
    queryKey: settingsQueryKey,
    queryFn: () => call(api.GET('/api/settings')),
    staleTime: 5 * 60_000,
  })
  return data
}
