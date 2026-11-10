import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Role, SessionInfo, Settings } from '@/api/types'
import { initI18n } from '@/i18n'
import { json, mockFetch } from '@/test/fetch'
import {
  apiError,
  emptyFeedRoutes,
  settingsFixture,
  userFixture,
} from '@/test/fixtures'
import { renderApp } from '@/test/router'

beforeEach(() => {
  initI18n('ko')
})

afterEach(cleanup)

function session(over: Partial<SessionInfo>): SessionInfo {
  return {
    id: '00000000-0000-4000-8000-0000000000e1',
    created_at: '2026-01-01T00:00:00Z',
    last_seen_at: '2026-01-02T00:00:00Z',
    current: false,
    user_agent: 'Firefox',
    ...over,
  }
}

const CURRENT = session({
  id: '00000000-0000-4000-8000-0000000000e0',
  current: true,
  user_agent: 'Chrome',
})
const OTHER = session({})

function renderPage(
  extra: Parameters<typeof mockFetch>[0] = {},
  {
    role = 'guardian',
    settings = settingsFixture,
    path = '/me/profile',
  }: { role?: Role; settings?: Settings; path?: string } = {},
) {
  mockFetch({
    'GET /api/auth/me': () => json(200, { user: userFixture(role) }),
    'GET /api/settings': () => json(200, settings),
    'GET /api/auth/sessions': () => json(200, { sessions: [CURRENT, OTHER] }),
    ...emptyFeedRoutes,
    ...extra,
  })
  return renderApp(path)
}

describe('me sub pages', () => {
  it('wrong_current_password_stays_logged_in', async () => {
    const { user, router } = renderPage(
      {
        'POST /api/users/me/password': () =>
          apiError(401, 'auth.invalidCredentials'),
      },
      { path: '/me/password' },
    )
    await user.type(await screen.findByLabelText('현재 비밀번호'), 'wrong-pass')
    await user.type(screen.getByLabelText('새 비밀번호'), 'new-password-1')
    await user.click(screen.getByRole('button', { name: '비밀번호 바꾸기' }))

    expect(
      await screen.findByText('현재 비밀번호가 맞지 않아요.'),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/me/password')
  })

  it('password_change_invalidates_sessions', async () => {
    const { user, queryClient } = renderPage(
      { 'POST /api/users/me/password': () => json(204, null) },
      { path: '/me/password' },
    )
    // 서버가 다른 세션을 지우므로 목록 캐시 무효화.
    queryClient.setQueryData(['sessions'], { sessions: [CURRENT, OTHER] })
    await user.type(
      await screen.findByLabelText('현재 비밀번호'),
      'old-password-1',
    )
    await user.type(screen.getByLabelText('새 비밀번호'), 'new-password-1')
    await user.click(screen.getByRole('button', { name: '비밀번호 바꾸기' }))
    await waitFor(() => {
      expect(queryClient.getQueryState(['sessions'])?.isInvalidated).toBe(true)
    })
  })

  it('timezone_list_falls_back_without_intl_support', async () => {
    const spy = vi.spyOn(Intl, 'supportedValuesOf').mockImplementation(() => {
      throw new RangeError('unsupported')
    })
    renderPage({}, { role: 'owner', path: '/me/instance' })
    const select = await screen.findByLabelText('시간대')
    expect(within(select).getAllByRole('option')).toHaveLength(1)
    spy.mockRestore()
  })

  it('locale_change_applies', async () => {
    const bodies: unknown[] = []
    const { user } = renderPage(
      {
        'PATCH /api/users/me': async (req) => {
          bodies.push(await req.json())
          return json(200, {
            user: { ...userFixture('guardian'), locale: 'en' },
          })
        },
      },
      { path: '/me/appearance' },
    )
    await user.selectOptions(await screen.findByLabelText('언어'), 'en')
    expect(
      await screen.findByRole('heading', { name: 'Display & language' }),
    ).toBeInTheDocument()
    expect(bodies).toEqual([{ locale: 'en' }])
  })

  it('theme_change_applies', async () => {
    const { user } = renderPage({}, { path: '/me/appearance' })
    await user.selectOptions(await screen.findByLabelText('테마'), 'dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('profile_save_refreshes_member_names', async () => {
    const { user, queryClient } = renderPage({
      'PATCH /api/users/me': () =>
        json(200, {
          user: { ...userFixture('guardian'), display_name: '엄마' },
        }),
    })
    // 피드 올린 사람 이름용 멤버 목록 캐시.
    queryClient.setQueryData(['users'], { users: [userFixture('guardian')] })
    const name = await screen.findByLabelText('표시 이름')
    await user.clear(name)
    await user.type(name, '엄마')
    await user.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => {
      expect(queryClient.getQueryState(['users'])?.isInvalidated).toBe(true)
    })
  })

  it('instance_page_renders_for_owner', async () => {
    renderPage({}, { role: 'owner', path: '/me/instance' })
    expect(
      await screen.findByRole('heading', { name: '우리 집 설정' }),
    ).toBeInTheDocument()
  })

  it('instance_patch_sends_changed_fields_only', async () => {
    const bodies: unknown[] = []
    const { user } = renderPage(
      {
        'PATCH /api/settings': async (req) => {
          bodies.push(await req.json())
          return json(200, { ...settingsFixture, trash_retention_days: 30 })
        },
      },
      {
        role: 'owner',
        path: '/me/instance',
        settings: { ...settingsFixture, trash_retention_days: 14 },
      },
    )
    const input = await screen.findByLabelText('휴지통 보관 일수')
    await user.clear(input)
    await user.type(input, '30')
    await user.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => {
      expect(bodies).toEqual([{ trash_retention_days: 30 }])
    })
  })

  it('same_device_sessions_have_distinct_labels', async () => {
    const A = session({ id: 'a', last_seen_at: '2026-01-02T00:00:00Z' })
    const B = session({ id: 'b', last_seen_at: '2026-01-03T00:00:00Z' })
    renderPage(
      {
        'GET /api/auth/sessions': () =>
          json(200, { sessions: [CURRENT, A, B] }),
      },
      { path: '/me/devices' },
    )
    const buttons = await screen.findAllByRole('button', {
      name: /^Firefox 로그아웃/,
    })
    await waitFor(() => {
      const names = screen
        .getAllByRole('button', { name: /^Firefox 로그아웃/ })
        .map((b) => b.getAttribute('aria-label'))
      expect(new Set(names).size).toBe(2)
    })
    expect(buttons).toHaveLength(2)
  })

  it('revoke_other_session', async () => {
    let deleted = ''
    const { user } = renderPage(
      {
        [`DELETE /api/auth/sessions/${OTHER.id}`]: () => {
          deleted = OTHER.id
          return json(204, null)
        },
      },
      { path: '/me/devices' },
    )
    await screen.findByText('Chrome')
    expect(
      screen.queryByRole('button', { name: /^Chrome 로그아웃/ }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Firefox 로그아웃/ }))
    await waitFor(() => {
      expect(deleted).toBe(OTHER.id)
    })
  })
})
