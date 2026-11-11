import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Role } from '@/api/types'
import { initI18n } from '@/i18n'
import ko from '@/locales/ko.json'
import { json, mockFetch } from '@/test/fetch'
import { emptyFeedRoutes, settingsFixture, userFixture } from '@/test/fixtures'
import { renderApp } from '@/test/router'

beforeEach(() => {
  initI18n('ko')
})

afterEach(cleanup)

function renderMe(role: Role, path = '/me') {
  mockFetch({
    'GET /api/auth/me': () => json(200, { user: userFixture(role) }),
    'GET /api/settings': () => json(200, settingsFixture),
    'GET /api/auth/status': () => json(200, { signup_open: false }),
    'GET /api/auth/sessions': () => json(200, { sessions: [] }),
    'POST /api/auth/logout': () => json(204, null),
    ...emptyFeedRoutes,
  })
  return renderApp(path)
}

describe('MePage', () => {
  it('menu_groups_by_role', async () => {
    renderMe('family')
    await screen.findByRole('link', { name: '프로필' })
    const main = within(screen.getByRole('main'))
    expect(main.getByRole('link', { name: '비밀번호 바꾸기' })).toBeVisible()
    expect(main.getByRole('link', { name: '로그인한 기기' })).toBeVisible()
    expect(screen.queryByRole('link', { name: '휴지통' })).toBeNull()
    expect(screen.queryByRole('link', { name: '우리 집 설정' })).toBeNull()
    cleanup()

    renderMe('guardian')
    expect(
      await screen.findByRole('link', { name: '휴지통' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '우리 집 설정' })).toBeNull()
    cleanup()

    renderMe('owner')
    expect(
      await screen.findByRole('link', { name: '우리 집 설정' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '휴지통' })).toBeInTheDocument()
  })

  it('favorites_row_for_all_roles', async () => {
    for (const role of ['family', 'guardian', 'owner'] as const) {
      renderMe(role)
      const group = (
        await screen.findByRole('heading', { name: ko.me.photos })
      ).closest('section')
      if (!group) throw new Error('사진 그룹 없음')
      const rows = within(group).getAllByRole('link')
      expect(rows[0]).toHaveAccessibleName(ko.me.favorites)
      expect(rows[0]).toHaveAttribute('href', '/me/favorites')
      // 휴지통은 업로드 권한 있을 때 즐겨찾기 아래.
      expect(rows.map((r) => r.textContent)).toEqual(
        role === 'family' ? [ko.me.favorites] : [ko.me.favorites, ko.me.trash],
      )
      cleanup()
    }
  })

  it('shows_name_username_role', async () => {
    renderMe('owner')
    const me = userFixture('owner')
    expect(
      await screen.findByRole('heading', { name: me.display_name }),
    ).toBeInTheDocument()
    expect(screen.getByText(`@${me.username}`)).toBeInTheDocument()
    expect(screen.getByText('관리자')).toBeInTheDocument()
  })

  it('logout_from_me', async () => {
    const { user, router } = renderMe('guardian')
    await user.click(await screen.findByRole('button', { name: '로그아웃' }))
    await waitFor(() => {
      expect(router.state.location.href).toBe('/login')
    })
  })

  it('app_version_shown', async () => {
    renderMe('family')
    expect(await screen.findByText(/^앱 버전 \d+\.\d+\.\d+/)).toBeVisible()
  })

  it('sub_page_back_returns_to_me', async () => {
    const { user, router } = renderMe('family', '/me/devices')
    await user.click(await screen.findByRole('button', { name: '뒤로' }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/me')
    })
  })

  it('back_pops_history', async () => {
    const { user, router } = renderMe('family')
    await user.click(await screen.findByRole('link', { name: '로그인한 기기' }))
    await screen.findByRole('heading', { name: '로그인한 기기', level: 1 })
    const length = window.history.length
    await user.click(screen.getByRole('button', { name: '뒤로' }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/me')
    })
    expect(window.history.length).toBe(length)
  })

  it('instance_page_owner_only', async () => {
    const { router } = renderMe('guardian', '/me/instance')
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/me')
    })
  })
})
