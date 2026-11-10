import { queryOptions, useQuery } from '@tanstack/react-query'
import { api, call } from '@/api/client'

export const babiesKey = ['babies'] as const

// 서버 정렬(sort_order) 그대로.
export const babiesQuery = queryOptions({
  queryKey: babiesKey,
  queryFn: () => call(api.GET('/api/babies')),
})

export function useBabies() {
  return useQuery(babiesQuery)
}
