import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query'
import { useMemo } from 'react'
import { api, call } from '@/api/client'
import { ApiError } from '@/api/errors'
import type { Asset, AssetPage, AssetSummary } from '@/api/types'

// 무효화는 ['assets'] 접두로 전체.
export function timelineKey(babyId?: string) {
  return ['assets', { baby: babyId ?? null }] as const
}

export function assetKey(id: string) {
  return ['asset', id] as const
}

// refetchOnMount false: 뷰어용. 이미 받은 페이지 전체 재조회 방지.
export function useTimeline(
  babyId: string | undefined,
  { refetchOnMount = true }: { refetchOnMount?: boolean } = {},
) {
  const query = useInfiniteQuery({
    queryKey: timelineKey(babyId),
    queryFn: ({ pageParam }) =>
      call(
        api.GET('/api/assets', {
          params: {
            query: { limit: 100, cursor: pageParam, baby_id: babyId },
          },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.next_cursor ?? undefined,
    // 필터 전환 중 이전 목록 유지.
    placeholderData: keepPreviousData,
    // 뷰어 왕복·탭 전환마다 받은 페이지 전체 재조회 방지. 변경은 ['assets'] 무효화로 반영.
    staleTime: 60_000,
    refetchOnMount,
  })
  const { data } = query
  const items = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data])
  return {
    items,
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

// 처리 결과 필드만 교체. local_date·taken_at 은 처리로 바뀌지 않음.
function applyProcessed(qc: QueryClient, a: Asset): void {
  const merge = (s: AssetSummary): AssetSummary =>
    s.id !== a.id
      ? s
      : {
          ...s,
          status: a.status,
          kind: a.kind,
          width: a.width,
          height: a.height,
          duration_ms: a.duration_ms,
          blurhash: a.blurhash,
          dominant_color: a.dominant_color,
          derivatives: a.derivatives,
          baby_ids: a.baby_ids,
        }
  // ['assets'] 아래에 다른 모양의 쿼리가 생겨도 무시.
  qc.setQueriesData<InfiniteData<AssetPage>>(
    { queryKey: ['assets'] },
    (old) => {
      if (!old?.pages) return old
      return {
        ...old,
        pages: old.pages.map((p) => ({ ...p, items: p.items.map(merge) })),
      }
    },
  )
}

// 처리 중 항목을 화면에 보이는 동안만 5초 간격 조회. 끝나면 목록 캐시 교체 → 폴링 주체 해제.
export function useProcessingPoll(item: AssetSummary, visible: boolean): void {
  const qc = useQueryClient()
  useQuery({
    queryKey: assetKey(item.id),
    queryFn: async () => {
      const a = await call(
        api.GET('/api/assets/{id}', { params: { path: { id: item.id } } }),
      )
      // 새로 받은 응답만 반영. 캐시의 옛 응답으로 목록을 되돌리지 않음.
      if (a.status !== 'processing') applyProcessed(qc, a)
      return a
    },
    enabled: visible,
    // 휴지통 이동 등 4xx 는 반복해도 같은 결과.
    refetchInterval: (q) =>
      q.state.error instanceof ApiError &&
      q.state.error.status >= 400 &&
      q.state.error.status < 500
        ? false
        : 5000,
  })
}
