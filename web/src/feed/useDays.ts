import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { api, call } from '@/api/client'

export interface DaysFilter {
  baby?: string | undefined
  from?: string | undefined
  to?: string | undefined
}

// 무효화는 ['days'] 접두로 전체. ['assets'] 무효화 지점마다 함께.
export function daysKey(filter: DaysFilter) {
  return ['days', filter] as const
}

export function useDays(filter: DaysFilter) {
  const query = useInfiniteQuery({
    queryKey: daysKey(filter),
    queryFn: ({ pageParam }) =>
      call(
        api.GET('/api/days', {
          params: {
            query: {
              limit: 20,
              cursor: pageParam,
              baby_id: filter.baby,
              from: filter.from,
              to: filter.to,
            },
          },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.next_cursor ?? undefined,
    // 필터 전환 중 이전 목록 유지.
    placeholderData: keepPreviousData,
    // 뷰어 왕복·탭 전환마다 받은 페이지 전체 재조회 방지. 변경은 ['days'] 무효화로 반영.
    staleTime: 60_000,
  })
  const { data } = query
  const days = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data])
  return {
    days,
    fetchNextPage: query.fetchNextPage,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    isFetchNextPageError: query.isFetchNextPageError,
    isLoadingError: query.isLoadingError,
    isPlaceholderData: query.isPlaceholderData,
    status: query.status,
    error: query.error,
    refetch: query.refetch,
  }
}
