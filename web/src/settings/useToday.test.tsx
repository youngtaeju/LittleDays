import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { settingsFixture } from '@/test/fixtures'
import { settingsQueryKey, useToday } from './useSettings'

afterEach(() => {
  vi.useRealTimers()
})

it('rolls_over_at_midnight', () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  // settingsFixture 시간대(Asia/Seoul) 23:59:30.
  vi.setSystemTime(new Date('2026-11-11T14:59:30Z'))
  const qc = new QueryClient()
  qc.setQueryData(settingsQueryKey, settingsFixture)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(() => useToday(), { wrapper })
  expect(result.current).toBe('2026-11-11')

  act(() => {
    vi.advanceTimersByTime(60_000)
  })
  expect(result.current).toBe('2026-11-12')
})
