import { onlineManager, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { api, call } from '@/api/client'
import { json, mockFetch } from '@/test/fetch'
import { userFixture } from '@/test/fixtures'
import {
  createQueryClient,
  loadMe,
  meQueryKey,
  useLogout,
  useMe,
} from './session'
import { uploadStore } from '@/upload/useUploadStore'

function setup() {
  const onLogout = vi.fn()
  const qc = createQueryClient(onLogout)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  return { onLogout, qc, wrapper }
}

describe('session', () => {
  it('me_401_is_logged_out_not_error', async () => {
    mockFetch({
      'GET /api/auth/me': () =>
        json(401, { error: 'auth.required', params: {} }),
    })
    const { onLogout, wrapper } = setup()
    const { result } = renderHook(() => useMe(), { wrapper })
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })
    expect(result.current.user).toBeNull()
    expect(onLogout).not.toHaveBeenCalled()
  })

  // 공용 기기: 세션 만료 후 다음 사용자에게 이전 사용자의 이어올리기 목록(파일 이름) 노출 금지.
  it('me_401_clears_pending_uploads', async () => {
    uploadStore.put({
      id: 'f1',
      name: 'private.jpg',
      status: 'resumable',
      progress: 0,
      resume: { size: 1, lastModified: 1, babyIds: [] },
    })
    expect(localStorage.getItem('ld.upload.pending')).not.toBeNull()
    mockFetch({
      'GET /api/auth/me': () =>
        json(401, { error: 'auth.required', params: {} }),
    })
    const { qc } = setup()
    expect(await loadMe(qc)).toBeNull()
    expect(uploadStore.getSnapshot()).toEqual([])
    expect(localStorage.getItem('ld.upload.pending')).toBeNull()
  })

  it('apiErrorLogout', async () => {
    let key = 'auth.disabled'
    mockFetch({
      'GET /api/babies': () => json(401, { error: key, params: {} }),
    })
    const { onLogout, qc } = setup()
    qc.setQueryData(meQueryKey, { id: 'u' })
    qc.setQueryData(['other'], 1)
    const fail = () => call(api.GET('/api/babies'))

    // 마운트된 관찰자는 캐시 비움 후 쿼리를 다시 만들므로 qc.query 로 검사.
    await expect(qc.query({ queryKey: ['a'], queryFn: fail })).rejects.toThrow()
    expect(onLogout).toHaveBeenCalledTimes(1)
    expect(qc.getQueryData(meQueryKey)).toBeNull()
    // 이전 사용자 데이터 제거.
    expect(qc.getQueryData(['other'])).toBeUndefined()

    key = 'auth.invalidCredentials'
    await expect(qc.query({ queryKey: ['b'], queryFn: fail })).rejects.toThrow()
    expect(onLogout).toHaveBeenCalledTimes(1)
  })

  // 가드 경로는 재시도 없이 즉시 '모름'. 오프라인 이동 지연 방지.
  it('load_me_does_not_retry', async () => {
    let calls = 0
    mockFetch({
      'GET /api/auth/me': () => {
        calls += 1
        throw new TypeError('Failed to fetch')
      },
    })
    const { qc } = setup()
    expect(await loadMe(qc)).toBeUndefined()
    expect(calls).toBe(1)
  })

  // 브라우저 오프라인 상태에서도 대기 없이 실패. 화면 이동 멈춤 방지.
  it('load_me_fails_fast_when_offline', async () => {
    mockFetch({
      'GET /api/auth/me': () => {
        throw new TypeError('Failed to fetch')
      },
    })
    const { qc } = setup()
    onlineManager.setOnline(false)
    try {
      expect(await loadMe(qc)).toBeUndefined()
    } finally {
      onlineManager.setOnline(true)
    }
  })

  // 화면의 useMe 가 오프라인에서 일시정지한 조회를 가드가 이어받아 기다리지 않음.
  it('load_me_skips_paused_refetch', async () => {
    mockFetch({
      'GET /api/auth/me': () => {
        throw new TypeError('Failed to fetch')
      },
    })
    const { qc, wrapper } = setup()
    qc.setQueryData(meQueryKey, userFixture('guardian'), { updatedAt: 0 })
    onlineManager.setOnline(false)
    try {
      renderHook(() => useMe(), { wrapper })
      await waitFor(() => {
        expect(qc.getQueryState(meQueryKey)?.fetchStatus).toBe('paused')
      })
      const pending = Symbol('pending')
      const result = await Promise.race([
        loadMe(qc),
        new Promise<symbol>((r) => {
          setTimeout(() => {
            r(pending)
          }, 1000)
        }),
      ])
      expect(result).toBeUndefined()
    } finally {
      onlineManager.setOnline(true)
    }
  })

  // 로그아웃(직접·강제) 시 파생물 캐시 삭제. 세션 없이 캐시 응답 방지.
  it('sign_out_clears_derivative_cache', async () => {
    const del = vi.fn<(name: string) => Promise<boolean>>()
    del.mockResolvedValue(true)
    vi.stubGlobal('caches', { delete: del })
    mockFetch({
      'GET /api/babies': () =>
        json(401, { error: 'auth.required', params: {} }),
    })
    const { qc } = setup()
    await expect(
      qc.query({
        queryKey: ['a'],
        queryFn: () => call(api.GET('/api/babies')),
      }),
    ).rejects.toThrow()
    expect(del).toHaveBeenCalledWith('ld-derivatives')
  })

  // 오프라인 API 캐시도 삭제. 같은 기기에서 이전 사용자 화면 노출 방지.
  it('sign_out_clears_api_cache', async () => {
    const del = vi.fn<(name: string) => Promise<boolean>>()
    del.mockResolvedValue(true)
    vi.stubGlobal('caches', { delete: del })
    mockFetch({
      'POST /api/auth/logout': () => new Response(null, { status: 204 }),
    })
    const { wrapper } = setup()
    const { result } = renderHook(() => useLogout(), { wrapper })
    await result.current()
    expect(del).toHaveBeenCalledWith('ld-api')
    expect(del).toHaveBeenCalledWith('ld-derivatives')
  })

  // 세션 만료(me 401)도 로그아웃과 동일. 캐시된 이전 me 로 오프라인 진입 방지.
  it('me_401_clears_offline_caches', async () => {
    const del = vi.fn<(name: string) => Promise<boolean>>()
    del.mockResolvedValue(true)
    vi.stubGlobal('caches', { delete: del })
    mockFetch({
      'GET /api/auth/me': () =>
        json(401, { error: 'auth.required', params: {} }),
    })
    const { qc } = setup()
    expect(await loadMe(qc)).toBeNull()
    expect(del).toHaveBeenCalledWith('ld-api')
    expect(del).toHaveBeenCalledWith('ld-derivatives')
  })
})
