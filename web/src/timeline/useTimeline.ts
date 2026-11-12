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
import type { Asset, AssetPage, AssetSummary, DayPage } from '@/api/types'

// 무효화는 ['assets'] 접두로 전체.
// date: 그날 화면의 하루 목록. 전체 타임라인 캐시와 키 분리.
export function timelineKey(babyId?: string, date?: string) {
  return [
    'assets',
    date ? { baby: babyId ?? null, date } : { baby: babyId ?? null },
  ] as const
}

export function assetKey(id: string) {
  return ['asset', id] as const
}

// refetchOnMount false: 뷰어용. 이미 받은 페이지 전체 재조회 방지. enabled false: 뷰어가 다른 목록(즐겨찾기, 이야기) 기준일 때, 사진 없는 날 화면.
export function useTimeline(
  babyId: string | undefined,
  {
    refetchOnMount = true,
    enabled = true,
    date,
  }: { refetchOnMount?: boolean; enabled?: boolean; date?: string } = {},
) {
  const query = useInfiniteQuery({
    queryKey: timelineKey(babyId, date),
    queryFn: ({ pageParam }) =>
      call(
        api.GET('/api/assets', {
          params: {
            query: { limit: 100, cursor: pageParam, baby_id: babyId, date },
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
    enabled,
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

// 처리 결과 필드만 교체. 촬영 시각 변경(날짜 묶음·순서)은 호출 측이 목록 재조회.
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
  // 하루 묶음 대표 사진. 그 항목이 있는 날만 새 객체(나머지 DayCard 는 그대로).
  qc.setQueriesData<InfiniteData<DayPage>>({ queryKey: ['days'] }, (old) => {
    if (!old?.pages) return old
    return {
      ...old,
      pages: old.pages.map((p) => ({
        ...p,
        items: p.items.map((d) =>
          d.preview.some((s) => s.id === a.id)
            ? { ...d, preview: d.preview.map(merge) }
            : d,
        ),
      })),
    }
  })
}

// 함께 보이던 항목은 응답이 몇 ms 차이로 따로 도착. 짧은 구간 안 요청을 목록 재조회 1회로 합침.
const REFETCH_WINDOW_MS = 300
const refetchScheduled = new WeakSet<QueryClient>()

function scheduleListRefetch(qc: QueryClient): void {
  if (refetchScheduled.has(qc)) return
  refetchScheduled.add(qc)
  setTimeout(() => {
    refetchScheduled.delete(qc)
    void qc.invalidateQueries({ queryKey: ['assets'] })
    void qc.invalidateQueries({ queryKey: ['days'] })
  }, REFETCH_WINDOW_MS)
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
      if (a.status !== 'processing') {
        applyProcessed(qc, a)
        // 처리 중 촬영 시각은 파일 수정 시각 등. EXIF·영상 메타로 바뀌면 다른 날로 이동.
        if (a.taken_at !== item.taken_at) scheduleListRefetch(qc)
      }
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
