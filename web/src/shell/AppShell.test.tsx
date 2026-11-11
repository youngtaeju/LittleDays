import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Baby, Role } from '@/api/types'
import { meQueryKey } from '@/auth/session'
import { initI18n } from '@/i18n'
import ko from '@/locales/ko.json'
import { json, mockFetch } from '@/test/fetch'
import { emptyFeedRoutes, settingsFixture, userFixture } from '@/test/fixtures'
import { renderApp } from '@/test/router'
import { uploadStore } from '@/upload/useUploadStore'

beforeEach(() => {
  initI18n('ko')
})

afterEach(() => {
  cleanup()
  uploadStore.reset()
  vi.restoreAllMocks()
})

async function renderShell(
  role: Role,
  path = '/',
  babies: Baby[] = [],
  extra: Parameters<typeof mockFetch>[0] = {},
) {
  mockFetch({
    ...emptyFeedRoutes,
    'GET /api/babies': () => json(200, babies),
    'GET /api/auth/me': () => json(200, { user: userFixture(role) }),
    'GET /api/settings': () => json(200, settingsFixture),
    'GET /api/auth/status': () => json(200, { signup_open: false }),
    'GET /api/auth/sessions': () => json(200, { sessions: [] }),
    'POST /api/auth/logout': () => json(204, null),
    ...extra,
  })
  const app = renderApp(path)
  await screen.findAllByText(settingsFixture.instance_name)
  return app
}

// 하단 탭 막대. 사이드바와 구분.
function tabBar() {
  return screen.getByTestId('tab-bar')
}

describe('AppShell', () => {
  it('tabs_by_role', async () => {
    await renderShell('owner')
    const owner = within(tabBar())
    expect(owner.getAllByRole('listitem')).toHaveLength(5)
    for (const name of [ko.nav.home, ko.nav.babies, ko.nav.family, ko.nav.me]) {
      expect(owner.getByRole('link', { name })).toBeInTheDocument()
    }
    expect(owner.getByRole('button', { name: ko.nav.add })).toBeInTheDocument()
    cleanup()

    await renderShell('family')
    const family = within(tabBar())
    expect(family.getAllByRole('listitem')).toHaveLength(4)
    expect(family.queryByRole('button', { name: ko.nav.add })).toBeNull()
    expect(
      screen.queryByRole('button', { name: ko.nav.add }),
    ).not.toBeInTheDocument()
  })

  it('selected_tab_marked', async () => {
    await renderShell('guardian', '/me')
    const tabs = within(tabBar())
    expect(tabs.getByRole('link', { name: ko.nav.me })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(tabs.getByRole('link', { name: ko.nav.home })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('sidebar_has_favorites', async () => {
    const { user, router } = await renderShell('family', '/', [], {
      'GET /api/favorites': () => json(200, { items: [], next_cursor: null }),
    })
    const more = screen.getByRole('navigation', { name: ko.nav.more })
    const sidebar = more.parentElement
    if (!sidebar) throw new Error('사이드바 없음')
    const main = within(sidebar).getByRole('navigation', { name: ko.nav.main })
    // 주 메뉴 아래 보조 메뉴.
    expect(
      main.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    const link = within(more).getByRole('link', { name: ko.nav.favorites })
    expect(link).not.toHaveAttribute('aria-current')
    await user.click(link)
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/me/favorites')
    })
    expect(link).toHaveAttribute('aria-current', 'page')
  })

  it('sidebar_single_current_on_secondary', async () => {
    await renderShell('guardian', '/me/favorites', [], {
      'GET /api/favorites': () => json(200, { items: [], next_cursor: null }),
    })
    const more = screen.getByRole('navigation', { name: ko.nav.more })
    const sidebar = more.parentElement
    if (!sidebar) throw new Error('사이드바 없음')
    const current = within(sidebar)
      .getAllByRole('link')
      .filter((l) => l.getAttribute('aria-current') === 'page')
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveAccessibleName(ko.nav.favorites)
  })

  it('add_opens_picker', async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click')
    const { user } = await renderShell('guardian')
    await user.click(within(tabBar()).getByRole('button', { name: ko.nav.add }))
    expect(click).toHaveBeenCalledTimes(1)
    const input = click.mock.contexts[0]
    expect(input).toBeInstanceOf(HTMLInputElement)
    expect(input).toHaveAttribute('type', 'file')
    expect(input).toHaveAttribute('multiple')
  })

  it('logout_goes_to_login', async () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US')
    const { router, user, queryClient } = await renderShell('guardian', '/me')
    await user.click(await screen.findByRole('button', { name: ko.nav.logout }))
    await waitFor(() => {
      expect(router.state.location.href).toBe('/login')
    })
    expect(queryClient.getQueryData(meQueryKey)).toBeNull()
    // 비로그인 화면은 브라우저 언어.
    expect(document.documentElement.lang).toBe('en')
  })
})
