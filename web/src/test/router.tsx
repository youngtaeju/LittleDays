import { createMemoryHistory } from '@tanstack/react-router'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppView } from '@/App'
import { createApp } from '@/router'
import { createTestQueryClient } from './query'

// 라우터 포함 앱 전체를 path 에서 시작. 로그아웃 이동 연결은 실제 앱과 동일.
export function renderApp(path: string) {
  const app = createApp(
    createTestQueryClient,
    createMemoryHistory({ initialEntries: [path] }),
  )
  render(<AppView {...app} />)
  return { ...app, user: userEvent.setup() }
}
