import { createMemoryHistory } from '@tanstack/react-router'
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppView } from '@/App'
import { api, call } from '@/api/client'
import { meQueryKey } from '@/auth/session'
import { initI18n } from '@/i18n'
import ko from '@/locales/ko.json'
import { createApp } from '@/router'
import { json, mockFetch } from '@/test/fetch'
import {
  emptyTimelineRoutes,
  settingsFixture,
  userFixture,
} from '@/test/fixtures'
import { createTestQueryClient } from '@/test/query'
import { renderApp } from '@/test/router'
import { OfflineBanner } from './OfflineBanner'

const offline = () => {
  throw new TypeError('Failed to fetch')
}

beforeEach(() => {
  initI18n('ko')
})

describe('OfflineBanner', () => {
  it('shows_when_offline_event', () => {
    render(<OfflineBanner />)
    // 상태 영역은 항상 존재, 내용만 교체. 스크린 리더 알림 조건.
    const status = screen.getByRole('status')
    expect(status).toBeEmptyDOMElement()

    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(status).toHaveTextContent(ko.offline.banner)

    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(screen.queryByText(ko.offline.banner)).not.toBeInTheDocument()
  })

  // 마지막 API 호출 기준. 응답을 받으면 해제.
  it('shows_after_network_failure', async () => {
    let handler: () => Response = offline
    mockFetch({ 'GET /api/settings': () => handler() })
    render(<OfflineBanner />)

    await act(() => call(api.GET('/api/settings')).catch(() => undefined))
    expect(screen.getByText(ko.offline.banner)).toBeInTheDocument()

    handler = () => json(200, settingsFixture)
    await act(() => call(api.GET('/api/settings')))
    expect(screen.queryByText(ko.offline.banner)).not.toBeInTheDocument()
  })

  it('full_screen_when_me_unreachable', async () => {
    let me: () => Response = offline
    mockFetch({
      ...emptyTimelineRoutes,
      'GET /api/auth/me': () => me(),
      'GET /api/settings': () => json(200, settingsFixture),
    })
    const { router, user } = renderApp('/')

    const retry = await screen.findByRole('button', { name: ko.common.retry })
    expect(screen.getByText(ko.offline.screen)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')

    me = () => json(200, { user: userFixture('guardian') })
    await user.click(retry)
    await screen.findAllByText(settingsFixture.instance_name)
    expect(screen.queryByText(ko.offline.screen)).not.toBeInTheDocument()
  })

  // 캐시된 me 가 있으면 셸 유지, 상단 띠만.
  it('banner_only_when_me_cached', async () => {
    mockFetch({
      'GET /api/auth/me': offline,
      'GET /api/settings': offline,
      'GET /api/babies': offline,
      'GET /api/assets': offline,
    })
    const app = createApp(
      createTestQueryClient,
      createMemoryHistory({ initialEntries: ['/'] }),
    )
    // 오래된 캐시. 가드가 재조회 시도.
    app.queryClient.setQueryData(meQueryKey, userFixture('guardian'), {
      updatedAt: 0,
    })
    render(<AppView {...app} />)

    expect(await screen.findByText(ko.offline.banner)).toBeInTheDocument()
    expect(screen.queryByText(ko.offline.screen)).not.toBeInTheDocument()
    expect(
      screen.getAllByRole('link', { name: ko.nav.home }).length,
    ).toBeGreaterThan(0)
  })
})
