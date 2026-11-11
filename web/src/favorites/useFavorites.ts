import { useInfiniteQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { api, call } from '@/api/client'
import { favoritesKey } from '@/reactions/useReactions'

// 즐겨찾기한 시각 최신순. 휴지통 제외는 서버.
// refetchOnMount false: 뷰어용. 이미 받은 페이지 전체 재조회 방지. enabled: 뷰어가 즐겨찾기에서 열렸을 때만.
export function useFavorites({
  refetchOnMount = true,
  enabled = true,
}: { refetchOnMount?: boolean; enabled?: boolean } = {}) {
  const query = useInfiniteQuery({
    queryKey: favoritesKey,
    queryFn: ({ pageParam }) =>
      call(
        api.GET('/api/favorites', {
          params: { query: { limit: 100, cursor: pageParam } },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.next_cursor ?? undefined,
    refetchOnMount,
    enabled,
  })
  const { data } = query
  const items = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data])
  // 쓰는 필드만 읽음. 추적 속성이 늘면 그만큼 다시 그림.
  return {
    items,
    fetchNextPage: query.fetchNextPage,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    isFetchNextPageError: query.isFetchNextPageError,
    isLoadingError: query.isLoadingError,
    status: query.status,
    error: query.error,
    refetch: query.refetch,
  }
}
