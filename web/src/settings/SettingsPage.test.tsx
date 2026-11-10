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

function renderSettings(
  extra: Parameters<typeof mockFetch>[0] = {},
  {
    role = 'guardian',
    settings = settingsFixture,
  }: { role?: Role; settings?: Settings } = {},
) {
  mockFetch({
    'GET /api/auth/me': () => json(200, { user: userFixture(role) }),
    'GET /api/settings': () => json(200, settings),
    'GET /api/auth/sessions': () => json(200, { sessions: [CURRENT, OTHER] }),
    ...emptyFeedRoutes,
    ...extra,
  })
  return renderApp('/me')
}

describe('SettingsPage', () => {
  it('wrong_current_password_stays_logged_in', async () => {
    const { user, router } = renderSettings({
      'POST /api/users/me/password': () =>
        apiError(401, 'auth.invalidCredentials'),
    })
    await user.type(await screen.findByLabelText('현재 비밀번호'), 'wrong-pass')
    await user.type(screen.getByLabelText('새 비밀번호'), 'new-password-1')
    await user.click(screen.getByRole('button', { name: '비밀번호 변경' }))

    expect(
      await screen.findByText('현재 비밀번호가 맞지 않아요.'),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/me')
  })

  it('password_change_refetches_sessions', async () => {
    let sessionCalls = 0
    const { user } = renderSettings({
      'GET /api/auth/sessions': () => {
        sessionCalls += 1
        return json(200, {
          sessions: sessionCalls === 1 ? [CURRENT, OTHER] : [CURRENT],
        })
      },
      'POST /api/users/me/password': () => json(204, null),
    })
    await screen.findByText('Firefox')
    await user.type(screen.getByLabelText('현재 비밀번호'), 'old-password-1')
    await user.type(screen.getByLabelText('새 비밀번호'), 'new-password-1')
    await user.click(screen.getByRole('button', { name: '비밀번호 변경' }))
    await waitFor(() => {
      expect(screen.queryByText('Firefox')).not.toBeInTheDocument()
    })
    expect(sessionCalls).toBe(2)
  })

  it('timezone_list_falls_back_without_intl_support', async () => {
    const spy = vi.spyOn(Intl, 'supportedValuesOf').mockImplementation(() => {
      throw new RangeError('unsupported')
    })
    renderSettings({}, { role: 'owner' })
    const select = await screen.findByLabelText('시간대')
    expect(within(select).getAllByRole('option')).toHaveLength(1)
    spy.mockRestore()
  })

  it('locale_change_applies', async () => {
    const bodies: unknown[] = []
    const { user } = renderSettings({
      'PATCH /api/users/me': async (req) => {
        bodies.push(await req.json())
        return json(200, { user: { ...userFixture('guardian'), locale: 'en' } })
      },
    })
    await user.selectOptions(await screen.findByLabelText('언어'), 'en')
    await user.click(
      within(screen.getByRole('region', { name: '프로필' })).getByRole(
        'button',
        { name: '저장' },
      ),
    )
    expect(
      await screen.findByRole('heading', { name: 'Profile' }),
    ).toBeInTheDocument()
    expect(bodies).toEqual([{ locale: 'en' }])
  })

  it('profile_save_refreshes_member_names', async () => {
    const { user, queryClient } = renderSettings({
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
    await user.click(
      within(screen.getByRole('region', { name: '프로필' })).getByRole(
        'button',
        { name: '저장' },
      ),
    )
    await waitFor(() => {
      expect(queryClient.getQueryState(['users'])?.isInvalidated).toBe(true)
    })
  })

  it('instance_section_owner_only', async () => {
    renderSettings()
    await screen.findByText('Chrome')
    expect(screen.queryByText('인스턴스')).not.toBeInTheDocument()
    cleanup()

    renderSettings({}, { role: 'owner' })
    expect(
      await screen.findByRole('heading', { name: '인스턴스' }),
    ).toBeInTheDocument()
  })

  it('instance_patch_sends_changed_fields_only', async () => {
    const bodies: unknown[] = []
    const { user } = renderSettings(
      {
        'PATCH /api/settings': async (req) => {
          bodies.push(await req.json())
          return json(200, { ...settingsFixture, trash_retention_days: 30 })
        },
      },
      {
        role: 'owner',
        settings: { ...settingsFixture, trash_retention_days: 14 },
      },
    )
    const input = await screen.findByLabelText('휴지통 보관 일수')
    await user.clear(input)
    await user.type(input, '30')
    await user.click(
      within(screen.getByRole('region', { name: '인스턴스' })).getByRole(
        'button',
        { name: '저장' },
      ),
    )
    await waitFor(() => {
      expect(bodies).toEqual([{ trash_retention_days: 30 }])
    })
  })

  it('same_device_sessions_have_distinct_labels', async () => {
    const A = session({ id: 'a', last_seen_at: '2026-01-02T00:00:00Z' })
    const B = session({ id: 'b', last_seen_at: '2026-01-03T00:00:00Z' })
    renderSettings({
      'GET /api/auth/sessions': () => json(200, { sessions: [CURRENT, A, B] }),
    })
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
    const { user } = renderSettings({
      [`DELETE /api/auth/sessions/${OTHER.id}`]: () => {
        deleted = OTHER.id
        return json(204, null)
      },
    })
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
