import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Role } from '@/api/types'
import { initI18n } from '@/i18n'
import ko from '@/locales/ko.json'
import { json, mockFetch } from '@/test/fetch'
import {
  albumFixture,
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

async function renderShell(role: Role, path: string) {
  mockFetch({
    ...emptyFeedRoutes,
    'GET /api/auth/me': () => json(200, { user: userFixture(role) }),
    'GET /api/settings': () => json(200, settingsFixture),
    'GET /api/babies': () => json(200, [SKY]),
    'GET /api/invites': () => json(200, { invites: [] }),
    'GET /api/auth/sessions': () => json(200, { sessions: [] }),
    'GET /api/days/2024-05-01': () => apiError(404, 'day.notFound'),
    'GET /api/assets': () => json(200, { items: [], next_cursor: null }),
    'GET /api/favorites': () => json(200, { items: [], next_cursor: null }),
    'GET /api/albums': () => json(200, []),
    'GET /api/albums/x': () => json(200, albumFixture('x')),
    'GET /api/albums/x/assets': () =>
      json(200, { items: [], next_cursor: null }),
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
  const app = renderApp(path)
  await screen.findByTestId('tab-bar')
  await waitFor(() => {
    expect(app.router.state.status).toBe('idle')
  })
  return app
}

describe('AddFab', () => {
  // 보호자 이상, 홈/달력/앨범 탭/아기 화면에서만.
  it.each([
    ['guardian', '/', true],
    ['guardian', '/calendar', true],
    ['guardian', '/albums', true],
    ['guardian', `/babies/${SKY.id}`, true],
    ['owner', '/', true],
    ['owner', `/babies/${SKY.id}`, true],
    ['family', '/', false],
    ['family', '/calendar', false],
    ['family', '/albums', false],
    ['family', `/babies/${SKY.id}`, false],
    ['guardian', '/albums/x', false],
    ['guardian', '/albums/favorites', false],
    ['guardian', `/babies/${SKY.id}/growth`, false],
    ['guardian', '/days/2024-05-01', false],
    ['guardian', '/me', false],
    ['guardian', '/family', false],
  ] as const)('fab_visibility %s %s', async (role, path, shown) => {
    const { router } = await renderShell(role, path)
    // 다른 주소로 넘어가지 않은 상태에서 판정.
    expect(router.state.location.pathname).toBe(path)
    if (shown) {
      expect(
        within(screen.getByTestId('add-fab')).getByRole('button', {
          name: ko.addSheet.open,
        }),
      ).toBeInTheDocument()
    } else {
      expect(screen.queryByTestId('add-fab')).toBeNull()
    }
  })

  it('fab_opens_add_sheet', async () => {
    const { user } = await renderShell('guardian', '/')
    const fab = screen.getByTestId('add-fab')
    expect(fab).toHaveClass('lg:hidden')
    const button = within(fab).getByRole('button', { name: ko.addSheet.open })
    expect(button).toHaveAttribute('aria-haspopup', 'dialog')
    await user.click(button)
    const sheet = await screen.findByRole('dialog', {
      name: ko.addSheet.title,
    })
    expect(
      within(sheet).getByRole('button', { name: ko.addSheet.story }),
    ).toBeInTheDocument()
    // 셸에 시트 하나.
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })
})
