import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { api, call } from '@/api/client'
import { ApiError } from '@/api/errors'
import type { Comment, StoryComment } from '@/api/types'
import { targetKey, type ReactionTarget } from '@/reactions/useReactions'

// 사진 댓글, 이야기 댓글 공용. 화면은 대상 id 필드를 쓰지 않음.
export type AnyComment = Comment | StoryComment

export function commentsKey(target: ReactionTarget) {
  return ['comments', target.kind, target.id] as const
}

// 오래된 순. 시트, 패널이 열려 있는 동안만 마운트되어 조회.
// 남은 페이지는 이어서 모두 받음. 끝까지 있어야 새 댓글이 목록 끝에 보임.
export function useComments(target: ReactionTarget) {
  const query = useInfiniteQuery({
    queryKey: commentsKey(target),
    queryFn: ({
      pageParam,
    }): Promise<{
      items: AnyComment[]
      next_cursor: string | null
    }> => {
      const params = {
        path: { id: target.id },
        query: { cursor: pageParam, limit: 100 },
      }
      return target.kind === 'asset'
        ? call(api.GET('/api/assets/{id}/comments', { params }))
        : call(api.GET('/api/stories/{id}/comments', { params }))
    },
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
function useRefresh(target: ReactionTarget) {
  const qc = useQueryClient()
  return async () => {
    void qc.invalidateQueries({ queryKey: targetKey(target) })
    void qc.invalidateQueries({ queryKey: ['days'] })
    await qc.invalidateQueries({ queryKey: commentsKey(target) })
  }
}

// 다른 가족이 먼저 지운 댓글 등. 고치기/지우기 대상이 이미 없음.
export function isCommentGone(e: unknown): boolean {
  return e instanceof ApiError && e.key === 'comment.notFound'
}

export function useCreateComment(target: ReactionTarget) {
  const refresh = useRefresh(target)
  return useMutation({
    mutationFn: (body: string): Promise<AnyComment> => {
      const opts = { params: { path: { id: target.id } }, body: { body } }
      return target.kind === 'asset'
        ? call(api.POST('/api/assets/{id}/comments', opts))
        : call(api.POST('/api/stories/{id}/comments', opts))
    },
    onSuccess: refresh,
  })
}

export function useUpdateComment(target: ReactionTarget) {
  const refresh = useRefresh(target)
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string
      body: string
    }): Promise<AnyComment> => {
      const opts = { params: { path: { id } }, body: { body } }
      return target.kind === 'asset'
        ? call(api.PATCH('/api/comments/{id}', opts))
        : call(api.PATCH('/api/story-comments/{id}', opts))
    },
    onSuccess: refresh,
    onError: (e) => {
      if (isCommentGone(e)) void refresh()
    },
  })
}

export function useDeleteComment(target: ReactionTarget) {
  const refresh = useRefresh(target)
  return useMutation({
    mutationFn: (id: string) => {
      const opts = { params: { path: { id } } }
      return target.kind === 'asset'
        ? call(api.DELETE('/api/comments/{id}', opts))
        : call(api.DELETE('/api/story-comments/{id}', opts))
    },
    onSuccess: refresh,
    onError: (e) => {
      if (isCommentGone(e)) void refresh()
    },
  })
}
