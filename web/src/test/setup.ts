import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { takeUnmatchedRequests } from './fetch'

afterEach(() => {
  const unmatched = takeUnmatchedRequests()
  if (unmatched.length > 0) {
    throw new Error(`mockFetch 미등록 요청:\n${unmatched.join('\n')}`)
  }
})

// jsdom 은 matchMedia 미구현.
window.matchMedia = (query: string): MediaQueryList =>
  ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }) as unknown as MediaQueryList
