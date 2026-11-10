import { screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Role } from '@/api/types'
import { initI18n } from '@/i18n'
import ko from '@/locales/ko.json'
import { json, mockFetch } from '@/test/fetch'
import {
  apiError,
  assetFixture,
  emptyTimelineRoutes,
  settingsFixture,
  userFixture,
} from '@/test/fixtures'
import { renderApp } from '@/test/router'

beforeEach(() => {
  initI18n('ko')
})

afterEach(() => {
  vi.restoreAllMocks()
})

function mockApp(role: Role) {
  mockFetch({
    ...emptyTimelineRoutes,
    'GET /api/auth/me': () => json(200, { user: userFixture(role) }),
    'GET /api/settings': () => json(200, settingsFixture),
    'GET /api/auth/sessions': () => json(200, { sessions: [] }),
    'GET /api/users': () => json(200, { users: [userFixture(role)] }),
    'GET /api/invites': () => json(200, { invites: [] }),
    'GET /api/trash': () => json(200, { items: [], next_cursor: null }),
    'GET /api/assets/a1': () => json(200, assetFixture('a1')),
  })
}

describe('router', () => {
  it.each([
    ['/photo/a1?baby=b1', '/photos/a1?baby=b1'],
    ['/members', '/family'],
    ['/settings', '/me'],
    ['/upload', '/'],
    ['/trash', '/me/trash'],
  ])('legacy_paths_redirect %s', async (from, to) => {
    mockApp('owner')
    const { router } = renderApp('/')
    await screen.findAllByText(settingsFixture.instance_name)
    const before = router.history.length

    await router.navigate({ href: from })
    await waitFor(() => {
      expect(router.state.location.href).toBe(to)
    })
    // 예전 주소는 기록에 남지 않음. 이동 1회분만 증가.
    expect(router.history.length).toBe(before + 1)
    router.history.back()
    await waitFor(() => {
      expect(router.state.location.href).toBe('/')
    })
  })

  it('legacy_path_direct_entry_replaced', async () => {
    mockApp('owner')
    const { router } = renderApp('/settings')
    await waitFor(() => {
      expect(router.state.location.href).toBe('/me')
    })
    expect(router.history.length).toBe(1)
  })

  it('family_route_open_to_all', async () => {
    mockApp('family')
    const { router } = renderApp('/family')
    expect(
      await screen.findByRole('heading', { name: ko.members.usersTitle }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/family')
    // 초대·역할 변경은 관리자만.
    expect(
      screen.queryByRole('button', { name: ko.members.createInvite }),
    ).not.toBeInTheDocument()
  })

  it('me_trash_guardian_only', async () => {
    mockApp('guardian')
    const { router } = renderApp('/me/trash')
    expect(
      await screen.findByRole('heading', { name: ko.nav.trash }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/me/trash')
  })

  it('login_redirect_keeps_new_path', async () => {
    mockFetch({
      'GET /api/auth/me': () => apiError(401, 'auth.required'),
      'GET /api/auth/status': () => json(200, { signup_open: false }),
    })
    const { router } = renderApp('/me/trash')
    await waitFor(() => {
      expect(router.state.location.href).toBe('/login?redirect=%2Fme%2Ftrash')
    })
  })
})
