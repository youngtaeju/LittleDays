import { queryOptions } from '@tanstack/react-query'
import { api, call } from '@/api/client'

// 마일스톤 상세 쿼리 키. 붙인 사진 업로드 완료 시 재조회 대상.
export function milestoneKey(id: string) {
  return ['milestone', id] as const
}

export function milestoneQuery(id: string) {
  return queryOptions({
    queryKey: milestoneKey(id),
    queryFn: () =>
      call(api.GET('/api/milestones/{id}', { params: { path: { id } } })),
  })
}
