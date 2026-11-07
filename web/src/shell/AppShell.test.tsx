import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Role } from '@/api/types'
import { meQueryKey } from '@/auth/session'
import { initI18n } from '@/i18n'
import ko from '@/locales/ko.json'
import { json, mockFetch } from '@/test/fetch'
import { settingsFixture, userFixture } from '@/test/fixtures'
import { renderApp } from '@/test/router'

beforeEach(() => {
  initI18n('ko')
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function renderShell(role: Role, path = '/') {
  mockFetch({
    'GET /api/auth/me': () => json(200, { user: userFixture(role) }),
    'GET /api/settings': () => json(200, settingsFixture),
    'GET /api/auth/status': () => json(200, { signup_open: false }),
    'POST /api/auth/logout': () => json(204, null),
  })
  const app = renderApp(path)
  await screen.findByText(settingsFixture.instance_name)
  return app
}

async function openMore(user: ReturnType<typeof renderApp>['user']) {
  await user.click(screen.getByRole('button', { name: ko.nav.more }))
  return within(await screen.findByRole('dialog'))
}

describe('AppShell', () => {
  it('family_has_no_upload_tab', async () => {
    await renderShell('family')
    expect(screen.queryAllByRole('link', { name: ko.nav.upload })).toHaveLength(
      0,
    )
    expect(
      screen.getAllByRole('link', { name: ko.nav.timeline }).length,
    ).toBeGreaterThan(0)
    cleanup()

    await renderShell('guardian')
    expect(
      screen.getAllByRole('link', { name: ko.nav.upload }).length,
    ).toBeGreaterThan(0)
  })

  it('owner_sees_members_in_more', async () => {
    const owner = await renderShell('owner')
    const ownerMore = await openMore(owner.user)
    expect(
      ownerMore.getByRole('link', { name: ko.nav.members }),
    ).toBeInTheDocument()
    expect(
      ownerMore.getByRole('link', { name: ko.nav.trash }),
    ).toBeInTheDocument()
    cleanup()

    const guardian = await renderShell('guardian')
    const guardianMore = await openMore(guardian.user)
    expect(
      guardianMore.queryByRole('link', { name: ko.nav.members }),
    ).not.toBeInTheDocument()
    expect(
      guardianMore.getByRole('link', { name: ko.nav.settings }),
    ).toBeInTheDocument()
  })

  it('logout_goes_to_login', async () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US')
    const { router, user, queryClient } = await renderShell('guardian')
    const more = await openMore(user)
    await user.click(more.getByRole('button', { name: ko.nav.logout }))
    await waitFor(() => {
      expect(router.state.location.href).toBe('/login')
    })
    expect(queryClient.getQueryData(meQueryKey)).toBeNull()
    // 비로그인 화면은 브라우저 언어.
    expect(document.documentElement.lang).toBe('en')
  })

  it('more_tab_marks_current', async () => {
    await renderShell('guardian', '/settings')
    expect(screen.getByRole('button', { name: ko.nav.more })).toHaveAttribute(
      'aria-current',
      'page',
    )
    cleanup()

    await renderShell('guardian', '/babies')
    expect(
      screen.getByRole('button', { name: ko.nav.more }),
    ).not.toHaveAttribute('aria-current')
  })
})
