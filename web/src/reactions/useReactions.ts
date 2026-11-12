import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api, call } from '@/api/client'
import { ApiError, isLogoutError } from '@/api/errors'
import type { Asset, Story } from '@/api/types'
import { storyKey } from '@/stories/useStory'
import { assetKey } from '@/timeline/useTimeline'

// 하트, 댓글 대상. 사진 또는 이야기.
export type ReactionTarget = { kind: 'asset' | 'story'; id: string }

export function likesKey(target: ReactionTarget) {
  return ['likes', target.kind, target.id] as const
}

export const favoritesKey = ['favorites'] as const

// 대상 상세 쿼리. 하트 즉시 반영, 반응 뒤 재조회 대상.
export function targetKey(target: ReactionTarget): QueryKey {
  return target.kind === 'asset' ? assetKey(target.id) : storyKey(target.id)
}

// 하트 누른 사람. 서버가 최신순 정렬.
export function useLikes(target: ReactionTarget, enabled: boolean) {
  return useQuery({
    queryKey: likesKey(target),
    queryFn: () => {
      const opts = { params: { path: { id: target.id } } }
      return target.kind === 'asset'
        ? call(api.GET('/api/assets/{id}/likes', opts))
        : call(api.GET('/api/stories/{id}/likes', opts))
    },
    enabled,
  })
}

// 즉시 반영 후 요청. 같은 대상의 같은 반응은 scope 로 순서대로 전송, 마지막 누른 값이 서버에 남음.
// quiet: 오류 알림 생략 조건. 되돌리기와 재조회는 그대로.
function useToggle<T>(
  target: ReactionTarget,
  kind: 'like' | 'favorite',
  send: (next: boolean) => Promise<unknown>,
  apply: (a: T, next: boolean) => T,
  related: QueryKey,
  quiet: (e: unknown, next: boolean) => boolean = () => false,
) {
  const qc = useQueryClient()
  const { t } = useTranslation()
  const key = targetKey(target)
  const mutationKey = [kind, target.kind, target.id]
  return useMutation({
    mutationKey,
    scope: { id: mutationKey.join(':') },
    mutationFn: send,
    onMutate: async (next: boolean) => {
      // 진행 중 상세 조회가 즉시 반영을 덮지 않게.
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<T>(key)
      if (prev) qc.setQueryData(key, apply(prev, next))
      return { prev }
    },
    onError: (e, next, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev)
      if (!isLogoutError(e) && !quiet(e, next)) {
        toast.error(t('reactions.saveFailed'))
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['days'] })
      void qc.invalidateQueries({ queryKey: related })
      // 마지막 요청 뒤에만 서버 값으로 맞춤. 중간 재조회는 뒤이은 누름의 즉시 반영을 되돌림.
      if (qc.isMutating({ mutationKey }) === 1) {
        void qc.invalidateQueries({ queryKey: key })
      }
    },
  })
}

function applyLike(a: Asset | Story, next: boolean): Asset | Story {
  if (a.liked === next) return a
  return {
    ...a,
    liked: next,
    like_count: Math.max(0, a.like_count + (next ? 1 : -1)),
  }
}

export function useToggleLike(target: ReactionTarget) {
  return useToggle(
    target,
    'like',
    (next) => {
      const opts = { params: { path: { id: target.id } } }
      if (target.kind === 'asset') {
        return next
          ? call(api.PUT('/api/assets/{id}/like', opts))
          : call(api.DELETE('/api/assets/{id}/like', opts))
      }
      return next
        ? call(api.PUT('/api/stories/{id}/like', opts))
        : call(api.DELETE('/api/stories/{id}/like', opts))
    },
    applyLike,
    likesKey(target),
  )
}

// fromFavorites: 즐겨찾기 화면에서 연 뷰어. 그사이 휴지통으로 간 사진의 ★ 끄기 404 는
// 오류 대신 목록 재조회(onSettled)로 정리.
export function useToggleFavorite(
  assetId: string,
  { fromFavorites = false }: { fromFavorites?: boolean } = {},
) {
  return useToggle<Asset>(
    { kind: 'asset', id: assetId },
    'favorite',
    (next) => {
      const opts = { params: { path: { id: assetId } } }
      return next
        ? call(api.PUT('/api/assets/{id}/favorite', opts))
        : call(api.DELETE('/api/assets/{id}/favorite', opts))
    },
    (a, next) => ({ ...a, favorited: next }),
    favoritesKey,
    (e, next) =>
      fromFavorites &&
      !next &&
      e instanceof ApiError &&
      e.status === 404 &&
      e.key === 'asset.notFound',
  )
}
