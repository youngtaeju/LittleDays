import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'
import { api, call } from '@/api/client'
import type { Asset } from '@/api/types'
import { assetKey } from '@/timeline/useTimeline'

// 타일 폴링·아바타 크기 공용 key.
export function assetQuery(id: string) {
  return queryOptions({
    queryKey: assetKey(id),
    queryFn: () =>
      call(api.GET('/api/assets/{id}', { params: { path: { id } } })),
  })
}

// 처리 중이면 3초 간격 조회.
export function useAsset(id: string) {
  return useQuery({
    ...assetQuery(id),
    refetchInterval: (q) =>
      q.state.data?.status === 'processing' ? 3000 : false,
  })
}

// 변경 응답으로 상세 교체, 목록은 다시 조회.
export function applyAsset(qc: QueryClient, a: Asset): void {
  qc.setQueryData(assetKey(a.id), a)
  void qc.invalidateQueries({ queryKey: ['assets'] })
  void qc.invalidateQueries({ queryKey: ['days'] })
}
