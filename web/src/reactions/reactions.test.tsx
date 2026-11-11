import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act, renderHook, screen, waitFor } from '@testing-library/react'
import i18next from 'i18next'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Asset } from '@/api/types'
import { Toaster } from '@/components/ui/sonner'
import { initI18n } from '@/i18n'
import ko from '@/locales/ko.json'
import { json, mockFetch } from '@/test/fetch'
import { apiError, assetFixture } from '@/test/fixtures'
import { createTestQueryClient } from '@/test/query'
import { assetKey } from '@/timeline/useTimeline'
import { assetQuery } from '@/viewer/useAsset'
import { likedByText } from './names'
import { useToggleLike } from './useReactions'

beforeEach(() => {
  initI18n('ko')
})

function setup(initial: Asset) {
  const qc = createTestQueryClient()
  qc.setQueryData(assetKey(initial.id), initial)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      {children}
      <Toaster />
    </QueryClientProvider>
  )
  // 뷰어처럼 상세를 보는 중. 무효화 시 재조회 대상.
  const { result } = renderHook(
    () => {
      useQuery({ ...assetQuery(initial.id), staleTime: Infinity })
      return useToggleLike(initial.id)
    },
    { wrapper },
  )
  const cached = () => qc.getQueryData<Asset>(assetKey(initial.id))
  return { qc, result, cached }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

describe('reactions', () => {
  it('liked_by_text', () => {
    const t = i18next.t.bind(i18next)
    expect(likedByText(t, ['할머니'], 1)).toBe('할머니')
    expect(likedByText(t, ['할머니', '아빠'], 2)).toBe('할머니, 아빠')
    expect(likedByText(t, ['할머니', '아빠', '엄마', '이모', '삼촌'], 5)).toBe(
      '할머니, 아빠 외 3명',
    )
  })

  it('rapid_like_toggle_settles', async () => {
    // 서버 상태는 응답 시점에 반영. 요청이 겹치면 늦게 끝난 쪽이 이김.
    let serverLiked = false
    let gets = 0
    const sent: string[] = []
    const delays = [10, 40, 10]
    const respond = async (liked: boolean) => {
      const delay = delays[sent.length] ?? 10
      sent.push(liked ? 'PUT' : 'DELETE')
      await sleep(delay)
      serverLiked = liked
      return json(204, null)
    }
    mockFetch({
      'PUT /api/assets/a/like': () => respond(true),
      'DELETE /api/assets/a/like': () => respond(false),
      'GET /api/assets/a': () => {
        gets++
        return json(
          200,
          assetFixture('a', {
            liked: serverLiked,
            like_count: 3 + (serverLiked ? 1 : 0),
          }),
        )
      },
    })
    const { qc, result, cached } = setup(assetFixture('a', { like_count: 3 }))

    await act(async () => {
      result.current.mutate(true)
      result.current.mutate(false)
      result.current.mutate(true)
      await Promise.resolve()
    })
    // 즉시 반영.
    expect(cached()).toMatchObject({ liked: true, like_count: 4 })

    await waitFor(() => {
      expect(qc.isMutating()).toBe(0)
    })
    await waitFor(() => {
      expect(qc.isFetching()).toBe(0)
    })
    expect(sent).toEqual(['PUT', 'DELETE', 'PUT'])
    // 중간 재조회 없이 마지막 요청 뒤 1회.
    expect(gets).toBe(1)
    expect(serverLiked).toBe(true)
    expect(cached()).toMatchObject({ liked: true, like_count: 4 })
  })

  it('like_failure_reverts', async () => {
    let release = () => {}
    const gate = new Promise<void>((r) => {
      release = r
    })
    mockFetch({
      'PUT /api/assets/a/like': () =>
        gate.then(() => apiError(500, 'internal')),
      'GET /api/assets/a': () =>
        json(200, assetFixture('a', { like_count: 2 })),
    })
    const { result, cached } = setup(assetFixture('a', { like_count: 2 }))

    await act(async () => {
      result.current.mutate(true)
      await Promise.resolve()
    })
    expect(cached()).toMatchObject({ liked: true, like_count: 3 })

    release()
    expect(await screen.findByText(ko.reactions.saveFailed)).toBeInTheDocument()
    expect(cached()).toMatchObject({ liked: false, like_count: 2 })
  })

  it('unlike_never_goes_below_zero', async () => {
    let release = () => {}
    const gate = new Promise<void>((r) => {
      release = r
    })
    mockFetch({
      'DELETE /api/assets/a/like': () => gate.then(() => json(204, null)),
      'GET /api/assets/a': () => json(200, assetFixture('a')),
    })
    const { qc, result, cached } = setup(
      assetFixture('a', { liked: true, like_count: 0 }),
    )
    await act(async () => {
      result.current.mutate(false)
      await Promise.resolve()
    })
    expect(cached()).toMatchObject({ liked: false, like_count: 0 })
    release()
    await waitFor(() => {
      expect(qc.isMutating() + qc.isFetching()).toBe(0)
    })
  })
})
