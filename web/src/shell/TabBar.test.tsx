import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Baby, Role } from '@/api/types'
import { initI18n } from '@/i18n'
import ko from '@/locales/ko.json'
import { json, mockFetch } from '@/test/fetch'
import {
  apiError,
  babyFixture,
  emptyFeedRoutes,
  settingsFixture,
  userFixture,
} from '@/test/fixtures'
import { renderApp } from '@/test/router'

beforeEach(() => {
  initI18n('ko')
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
})

const SKY = babyFixture()

function renderShell(role: Role, path = '/', babies: Baby[] = [SKY]) {
  mockFetch({
    ...emptyFeedRoutes,
    'GET /api/auth/me': () => json(200, { user: userFixture(role) }),
    'GET /api/settings': () => json(200, settingsFixture),
    'GET /api/babies': () => json(200, babies),
    'GET /api/invites': () => json(200, { invites: [] }),
    'GET /api/auth/sessions': () => json(200, { sessions: [] }),
    'GET /api/days/2024-05-01': () => apiError(404, 'day.notFound'),
    'GET /api/assets': () => json(200, { items: [], next_cursor: null }),
    'GET /api/stories/x': () => apiError(404, 'story.notFound'),
    'GET /api/favorites': () => json(200, { items: [], next_cursor: null }),
    'GET /api/albums': () => json(200, []),
    [`GET /api/babies/${SKY.id}/stats`]: () =>
      json(200, {
        photo_count: 0,
        video_count: 0,
        day_count: 0,
        age_months: [],
      }),
    [`GET /api/babies/${SKY.id}/growth`]: () => json(200, []),
    [`GET /api/babies/${SKY.id}/milestones`]: () => json(200, []),
  })
  return renderApp(path)
}

// 하단 탭 막대. 사이드바와 구분.
async function tabBar() {
  return within(await screen.findByTestId('tab-bar'))
}

// 칸마다 링크 또는 (+) 버튼의 접근성 이름.
function cellNames(tabs: Awaited<ReturnType<typeof tabBar>>): string[] {
  return tabs.getAllByRole('listitem').map((li: HTMLElement) => {
    const el = li.querySelector('a, button')
    return el?.getAttribute('aria-label') ?? el?.textContent ?? ''
  })
}

describe('TabBar', () => {
  it('tabs_by_role', async () => {
    renderShell('guardian')
    const tabs = await tabBar()
    expect(cellNames(tabs)).toEqual([
      ko.nav.home,
      ko.nav.calendar,
      ko.addSheet.open,
      ko.nav.albums,
      ko.nav.me,
    ])
    expect(
      [ko.nav.home, ko.nav.calendar, ko.nav.albums, ko.nav.me].map((name) =>
        tabs.getByRole('link', { name }).getAttribute('href'),
      ),
    ).toEqual(['/', '/calendar', '/albums', '/me'])
  })

  // 업로드 권한 없으면 (+) 자리에 일반 아기 탭.
  it('family_baby_tab', async () => {
    renderShell('family')
    const tabs = await tabBar()
    expect(cellNames(tabs)).toEqual([
      ko.nav.home,
      ko.nav.calendar,
      ko.nav.babies,
      ko.nav.albums,
      ko.nav.me,
    ])
    expect(tabs.getByRole('link', { name: ko.nav.babies })).toHaveAttribute(
      'href',
      '/babies',
    )
    expect(screen.queryByRole('button', { name: ko.addSheet.open })).toBeNull()
  })

  it.each([
    [`/babies/${SKY.id}`, ko.nav.babies],
    ['/family', ko.nav.me],
    ['/me', ko.nav.me],
  ])('family_selected_tab %s', async (path, name) => {
    const { router } = renderShell('family', path)
    const tabs = await tabBar()
    await waitFor(() => {
      expect(router.state.status).toBe('idle')
    })
    const current = tabs
      .getAllByRole('link')
      .filter((l) => l.getAttribute('aria-current') === 'page')
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveAccessibleName(name)
  })

  // 아기 없어도 탭 유지. 누르면 아기 없음 화면.
  it('family_tab_without_babies', async () => {
    const { router, user } = renderShell('family', '/', [])
    const tabs = await tabBar()
    await user.click(tabs.getByRole('link', { name: ko.nav.babies }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/babies')
    })
    expect(await screen.findByText(ko.babies.empty)).toBeInTheDocument()
    expect(tabs.getByRole('link', { name: ko.nav.babies })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  // 홈만 정확히 일치. 탭이 없어진 아기, 가족 화면은 나 탭.
  it.each([
    ['/', ko.nav.home],
    ['/?baby=x', ko.nav.home],
    ['/calendar', ko.nav.calendar],
    ['/albums', ko.nav.albums],
    ['/albums/favorites', ko.nav.albums],
    ['/me', ko.nav.me],
    ['/me/devices', ko.nav.me],
    [`/babies/${SKY.id}`, ko.nav.me],
    ['/family', ko.nav.me],
  ])('selected_tab %s', async (path, name) => {
    const { router } = renderShell('guardian', path)
    const tabs = await tabBar()
    await waitFor(() => {
      expect(router.state.status).toBe('idle')
    })
    const current = tabs
      .getAllByRole('link')
      .filter((l) => l.getAttribute('aria-current') === 'page')
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveAccessibleName(name)
  })

  // 탭에 속하지 않는 화면은 선택 탭 없음.
  it.each(['/days/2024-05-01', '/stories/x'])(
    'no_selected_tab %s',
    async (path) => {
      const { router } = renderShell('guardian', path)
      const tabs = await tabBar()
      await waitFor(() => {
        expect(router.state.status).toBe('idle')
      })
      const current = tabs
        .getAllByRole('link')
        .filter((l) => l.getAttribute('aria-current') === 'page')
      expect(current).toHaveLength(0)
    },
  )
})
