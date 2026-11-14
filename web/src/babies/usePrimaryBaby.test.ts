import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import type { Baby } from '@/api/types'
import { settingsQueryKey } from '@/settings/useSettings'
import { json, mockFetch } from '@/test/fetch'
import { apiError, babyFixture, settingsFixture } from '@/test/fixtures'
import { babiesKey } from '@/timeline/useBabies'
import { primaryBaby, usePrimaryBaby } from './usePrimaryBaby'

const SKY = babyFixture()
const SEA = babyFixture({
  id: '00000000-0000-4000-8000-0000000000b2',
  name: '바다',
  sort_order: 1,
})

// 캐시 미리 채움. 아기 목록 없을 때만 조회.
function renderPrimary(babies: Baby[] | undefined, primary: string | null) {
  const qc = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  })
  if (babies) qc.setQueryData(babiesKey, babies)
  qc.setQueryData(settingsQueryKey, {
    ...settingsFixture,
    primary_baby_id: primary,
  })
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children)
  return renderHook(() => usePrimaryBaby(), { wrapper }).result
}

// 아기 목록만 캐시. 설정은 조회.
function renderUnsettled(babies: Baby[]) {
  const qc = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  })
  qc.setQueryData(babiesKey, babies)
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children)
  return renderHook(() => usePrimaryBaby(), { wrapper }).result
}

describe('usePrimaryBaby', () => {
  it('primary_from_settings', () => {
    expect(primaryBaby([SKY, SEA], SEA.id)).toBe(SEA)
    expect(renderPrimary([SKY, SEA], SEA.id).current).toEqual(SEA)
  })

  it('primary_falls_back_to_first', () => {
    // 지워진 아기 id.
    expect(primaryBaby([SKY, SEA], 'gone')).toBe(SKY)
    expect(renderPrimary([SKY, SEA], 'gone').current).toEqual(SKY)
    // 설정 없음.
    expect(primaryBaby([SKY, SEA], null)).toBe(SKY)
    expect(primaryBaby([SKY, SEA], undefined)).toBe(SKY)
    expect(renderPrimary([SKY, SEA], null).current).toEqual(SKY)
  })

  it('no_babies', () => {
    expect(primaryBaby<Baby>([], SEA.id)).toBeUndefined()
    expect(renderPrimary([], SEA.id).current).toBeUndefined()
    // 조회 전(응답 대기).
    mockFetch({
      'GET /api/babies': () =>
        new Promise<Response>(() => {
          // 응답 없음.
        }),
    })
    expect(renderPrimary(undefined, SEA.id).current).toBeUndefined()
  })

  it('primary_waits_for_settings', async () => {
    // 설정 조회 중엔 없음(첫째로 먼저 그렸다 바뀌는 깜빡임 방지).
    let resolve: ((r: Response) => void) | undefined
    mockFetch({
      'GET /api/settings': () =>
        new Promise<Response>((r) => {
          resolve = r
        }),
    })
    const result = renderUnsettled([SKY, SEA])
    expect(result.current).toBeUndefined()
    await waitFor(() => {
      expect(resolve).toBeDefined()
    })
    expect(result.current).toBeUndefined()

    resolve?.(json(200, { ...settingsFixture, primary_baby_id: SEA.id }))
    await waitFor(() => {
      expect(result.current).toEqual(SEA)
    })
  })

  it('primary_settings_error_falls_back_to_first', async () => {
    mockFetch({ 'GET /api/settings': () => apiError(500, 'server.internal') })
    const result = renderUnsettled([SKY, SEA])
    await waitFor(() => {
      expect(result.current).toEqual(SKY)
    })
  })
})
