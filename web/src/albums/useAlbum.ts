import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { api, call } from '@/api/client'
import { albumsKeyRoot } from './useAlbums'

// 앨범 요약. 사진 목록 키의 접두라 무효화 시 함께.
export function albumKey(id: string) {
  return [...albumsKeyRoot, id] as const
}

export function albumAssetsKey(id: string) {
  return [...albumsKeyRoot, id, 'list'] as const
}

export function useAlbum(id: string) {
  return useQuery({
    queryKey: albumKey(id),
    queryFn: () =>
      call(api.GET('/api/albums/{id}', { params: { path: { id } } })),
  })
}

// 촬영 오래된 순. 휴지통 제외는 서버.
export function useAlbumAssets(id: string) {
  const query = useInfiniteQuery({
    queryKey: albumAssetsKey(id),
    queryFn: ({ pageParam }) =>
      call(
        api.GET('/api/albums/{id}/assets', {
          params: { path: { id }, query: { limit: 100, cursor: pageParam } },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.next_cursor ?? undefined,
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
