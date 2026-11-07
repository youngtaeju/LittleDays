import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { api, call } from '@/api/client'
import { json, mockFetch } from '@/test/fetch'
import { createQueryClient, meQueryKey, useMe } from './session'

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
    const { onLogout, qc, wrapper } = setup()
    qc.setQueryData(meQueryKey, { id: 'u' })

    const first = renderHook(
      () =>
        useQuery({
          queryKey: ['a'],
          queryFn: () => call(api.GET('/api/babies')),
        }),
      { wrapper },
    )
    await waitFor(() => {
      expect(first.result.current.isError).toBe(true)
    })
    expect(onLogout).toHaveBeenCalledTimes(1)
    expect(qc.getQueryData(meQueryKey)).toBeNull()

    key = 'auth.invalidCredentials'
    const second = renderHook(
      () =>
        useQuery({
          queryKey: ['b'],
          queryFn: () => call(api.GET('/api/babies')),
        }),
      { wrapper },
    )
    await waitFor(() => {
      expect(second.result.current.isError).toBe(true)
    })
    expect(onLogout).toHaveBeenCalledTimes(1)
  })
})
