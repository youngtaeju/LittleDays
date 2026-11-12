import { queryOptions, useQuery } from '@tanstack/react-query'
import { api, call } from '@/api/client'

// 이야기 상세 쿼리 키. 하트 즉시 반영, 댓글 뒤 재조회 대상.
export function storyKey(id: string) {
  return ['story', id] as const
}

export function storyQuery(id: string) {
  return queryOptions({
    queryKey: storyKey(id),
    queryFn: () =>
      call(api.GET('/api/stories/{id}', { params: { path: { id } } })),
  })
}

export function useStory(id: string) {
  return useQuery(storyQuery(id))
}
