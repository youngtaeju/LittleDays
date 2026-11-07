import { QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { api, call } from '@/api/client'
import { json, mockFetch } from '@/test/fetch'
import { createQueryClient, loadMe, meQueryKey, useMe } from './session'

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
})
