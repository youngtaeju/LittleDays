import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { api, call } from '@/api/client'
import { ApiError } from '@/api/errors'
import { assetKey } from '@/timeline/useTimeline'

export function commentsKey(assetId: string) {
  return ['comments', assetId] as const
}

// 오래된 순. 시트, 패널이 열려 있는 동안만 마운트되어 조회.
// 남은 페이지는 이어서 모두 받음. 끝까지 있어야 새 댓글이 목록 끝에 보임.
export function useComments(assetId: string) {
  const query = useInfiniteQuery({
    queryKey: commentsKey(assetId),
    queryFn: ({ pageParam }) =>
      call(
        api.GET('/api/assets/{id}/comments', {
          params: {
            path: { id: assetId },
            query: { cursor: pageParam, limit: 100 },
          },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.next_cursor ?? undefined,
    refetchOnWindowFocus: true,
  })
  const {
    data,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
  } = query
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) {
      void fetchNextPage()
    }
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage])
  const items = useMemo(() => data?.pages.flatMap((p) => p.items), [data])
  return { items, query }
}

// 목록은 응답을 붙이지 않고 다시 받음(받지 않은 중간 페이지 건너뛰기 방지). 목록 재조회까지 대기.
function useRefresh(assetId: string) {
  const qc = useQueryClient()
  return async () => {
    void qc.invalidateQueries({ queryKey: assetKey(assetId) })
    void qc.invalidateQueries({ queryKey: ['days'] })
    await qc.invalidateQueries({ queryKey: commentsKey(assetId) })
  }
}

// 다른 가족이 먼저 지운 댓글 등. 고치기/지우기 대상이 이미 없음.
export function isCommentGone(e: unknown): boolean {
  return e instanceof ApiError && e.key === 'comment.notFound'
}

export function useCreateComment(assetId: string) {
  const refresh = useRefresh(assetId)
  return useMutation({
    mutationFn: (body: string) =>
      call(
        api.POST('/api/assets/{id}/comments', {
          params: { path: { id: assetId } },
          body: { body },
        }),
      ),
    onSuccess: refresh,
  })
}

export function useUpdateComment(assetId: string) {
  const refresh = useRefresh(assetId)
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) =>
      call(
        api.PATCH('/api/comments/{id}', {
          params: { path: { id } },
          body: { body },
        }),
      ),
    onSuccess: refresh,
    onError: (e) => {
      if (isCommentGone(e)) void refresh()
    },
  })
}

export function useDeleteComment(assetId: string) {
  const refresh = useRefresh(assetId)
  return useMutation({
    mutationFn: (id: string) =>
      call(api.DELETE('/api/comments/{id}', { params: { path: { id } } })),
    onSuccess: refresh,
    onError: (e) => {
      if (isCommentGone(e)) void refresh()
    },
  })
}
