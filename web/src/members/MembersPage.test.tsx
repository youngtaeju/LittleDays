import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Invite, Role, User } from '@/api/types'
import { initI18n } from '@/i18n'
import { json, mockFetch } from '@/test/fetch'
import {
  emptyTimelineRoutes,
  settingsFixture,
  userFixture,
} from '@/test/fixtures'
import { renderApp } from '@/test/router'

beforeEach(() => {
  initI18n('ko')
})

afterEach(cleanup)

function member(over: Partial<User>): User {
  return { ...userFixture('family'), email: 'a@x.test', ...over }
}

const OWNER = userFixture('owner')
const DAD = member({
  id: '00000000-0000-4000-8000-000000000002',
  username: 'dad',
  display_name: '아빠',
  role: 'guardian',
})
const OTHER_OWNER = member({
  id: '00000000-0000-4000-8000-000000000003',
  username: 'mom2',
  display_name: '엄마2',
  role: 'owner',
})

function invite(over: Partial<Invite> = {}): Invite {
  return {
    id: '00000000-0000-4000-8000-0000000000c1',
    role: 'family',
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    created_by: OWNER.id,
    expires_at: '2026-01-04T00:00:00Z',
    revoked_at: null,
    used_at: null,
    used_by: null,
    ...over,
  }
}

function renderMembers(
  extra: Parameters<typeof mockFetch>[0] = {},
  {
    role = 'owner',
    users = [OWNER, DAD],
  }: { role?: Role; users?: User[] } = {},
) {
  mockFetch({
    'GET /api/auth/me': () => json(200, { user: userFixture(role) }),
    'GET /api/settings': () => json(200, settingsFixture),
    'GET /api/users': () => json(200, { users }),
    'GET /api/invites': () => json(200, { invites: [] }),
    ...emptyTimelineRoutes,
    ...extra,
  })
  return renderApp('/members')
}

describe('MembersPage', () => {
  it('create_invite_shows_url_and_copies', async () => {
    const bodies: unknown[] = []
    const { user } = renderMembers({
      'POST /api/invites': async (req) => {
        bodies.push(await req.json())
        return json(201, { url: 'http://x/invite/r', invite: invite() })
      },
    })
    await user.click(
      await screen.findByRole('button', { name: '초대 링크 만들기' }),
    )
    const input = await screen.findByDisplayValue('http://x/invite/r')
    expect(bodies).toEqual([{ role: 'family', expires_in_hours: 72 }])

    await user.click(screen.getByRole('button', { name: '복사' }))
    expect(await navigator.clipboard.readText()).toBe('http://x/invite/r')
    expect(input).toHaveAttribute('readonly')
  })

  it('role_change_patch', async () => {
    const bodies: unknown[] = []
    const { user } = renderMembers({
      [`PATCH /api/users/${DAD.id}`]: async (req) => {
        bodies.push(await req.json())
        return json(200, { user: { ...DAD, role: 'family' } })
      },
    })
    const select = await screen.findByRole('combobox', { name: '아빠 역할' })
    await user.selectOptions(select, 'family')
    await waitFor(() => {
      expect(bodies).toEqual([{ role: 'family' }])
    })
  })

  it('suspend_asks_confirmation', async () => {
    const bodies: unknown[] = []
    const { user } = renderMembers({
      [`PATCH /api/users/${DAD.id}`]: async (req) => {
        bodies.push(await req.json())
        return json(200, {
          user: { ...DAD, disabled_at: '2026-01-02T00:00:00Z' },
        })
      },
    })
    await user.click(await screen.findByRole('button', { name: '정지' }))
    const dialog = await screen.findByRole('dialog')
    expect(bodies).toEqual([])
    await user.click(within(dialog).getByRole('button', { name: '정지' }))
    await waitFor(() => {
      expect(bodies).toEqual([{ disabled: true }])
    })
  })

  it('owner_row_has_no_controls', async () => {
    renderMembers({}, { users: [OWNER, OTHER_OWNER, DAD] })
    await screen.findByRole('combobox', { name: '아빠 역할' })
    // 본인(owner)·다른 owner 행은 역할 변경·정지 없음. 편집 가능한 행은 아빠 하나.
    expect(screen.getAllByRole('combobox', { name: /^.+ 역할$/ })).toHaveLength(
      1,
    )
    expect(screen.getAllByRole('button', { name: '정지' })).toHaveLength(1)
  })

  it('revoke_active_invite_only', async () => {
    let revoked = ''
    const { user } = renderMembers({
      'GET /api/invites': () =>
        json(200, {
          invites: [
            invite(),
            invite({
              id: '00000000-0000-4000-8000-0000000000c2',
              status: 'used',
            }),
          ],
        }),
      'DELETE /api/invites/00000000-0000-4000-8000-0000000000c1': () => {
        revoked = 'c1'
        return json(204, null)
      },
    })
    // 사용됨 초대에는 버튼 없음. 중복이면 findByRole 이 실패.
    await user.click(await screen.findByRole('button', { name: /초대 회수/ }))
    await waitFor(() => {
      expect(revoked).toBe('c1')
    })
  })

  it('revoke_buttons_have_distinct_labels', async () => {
    renderMembers({
      'GET /api/invites': () =>
        json(200, {
          invites: [
            invite(),
            invite({
              id: '00000000-0000-4000-8000-0000000000c2',
              expires_at: '2026-01-05T00:00:00Z',
            }),
          ],
        }),
    })
    const buttons = await screen.findAllByRole('button', { name: /초대 회수/ })
    const names = buttons.map((b) => b.getAttribute('aria-label'))
    expect(names).toHaveLength(2)
    expect(new Set(names).size).toBe(2)
    expect(names[0]).toContain('1월 4일')
  })

  it('non_owner_redirected', async () => {
    const { router } = renderMembers({}, { role: 'guardian' })
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/')
    })
  })
})
