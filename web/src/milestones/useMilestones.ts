import { queryOptions, useQuery } from '@tanstack/react-query'
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

// 아기별 마일스톤 목록. 쓰기, 고치기, 지우기, 붙인 사진 업로드 완료 뒤 재조회 대상.
export const milestonesKeyRoot = ['milestones'] as const

export function milestonesKey(babyId: string) {
  return [...milestonesKeyRoot, babyId] as const
}

// 서버 정렬(달성일 오름차순).
export function milestonesQuery(babyId: string) {
  return queryOptions({
    queryKey: milestonesKey(babyId),
    queryFn: () =>
      call(
        api.GET('/api/babies/{id}/milestones', {
          params: { path: { id: babyId } },
        }),
      ),
  })
}

export function useMilestones(babyId: string) {
  return useQuery(milestonesQuery(babyId))
}
