import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { setNetworkDown } from '@/api/client'
import { takeUnmatchedRequests } from './fetch'
import { installIntersectionObserver } from './intersection'

afterEach(() => {
  // 오프라인 배너의 모듈 상태. 테스트 간 누수 방지.
  setNetworkDown(false)
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

// jsdom 은 createObjectURL 미구현. 업로드 확인 미리보기가 사용.
URL.createObjectURL = () => 'blob:test'
URL.revokeObjectURL = () => undefined

// jsdom 은 scrollTo 미구현. 라우터가 이동마다 호출(맨 위 이동 또는 저장 위치 복원). 테스트는 spy 로 확인.
window.scrollTo = () => undefined

installIntersectionObserver()

// jsdom 은 ResizeObserver 미구현. Radix Checkbox 가 크기 측정에 사용.
window.ResizeObserver = class {
  observe = () => undefined
  unobserve = () => undefined
  disconnect = () => undefined
}

// jsdom 은 미디어 재생 미구현(호출 시 경고). 영상 뷰어가 언마운트에서 pause 호출.
HTMLMediaElement.prototype.pause = () => undefined
HTMLMediaElement.prototype.play = () => Promise.resolve()
