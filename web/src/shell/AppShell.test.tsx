import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Baby, Role } from '@/api/types'
import { meQueryKey } from '@/auth/session'
import { initI18n } from '@/i18n'
import ko from '@/locales/ko.json'
import { json, mockFetch } from '@/test/fetch'
import {
  emptyFeedRoutes,
  settingsFixture,
  storyFixture,
  userFixture,
} from '@/test/fixtures'
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
    expect(
      owner.getByRole('button', { name: ko.addSheet.open }),
    ).toBeInTheDocument()
    cleanup()

    await renderShell('family')
    const family = within(tabBar())
    expect(family.getAllByRole('listitem')).toHaveLength(4)
    expect(family.queryByRole('button', { name: ko.addSheet.open })).toBeNull()
    expect(
      screen.queryByRole('button', { name: ko.addSheet.open }),
    ).not.toBeInTheDocument()
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
    await user.click(
      within(tabBar()).getByRole('button', { name: ko.addSheet.open }),
    )
    const sheet = await screen.findByRole('dialog', {
      name: ko.addSheet.title,
    })
    expect(click).not.toHaveBeenCalled()
    await user.click(
      within(sheet).getByRole('button', { name: ko.addSheet.upload }),
    )
    expect(click).toHaveBeenCalledTimes(1)
    const input = click.mock.contexts[0]
    expect(input).toBeInstanceOf(HTMLInputElement)
    expect(input).toHaveAttribute('type', 'file')
    expect(input).toHaveAttribute('multiple')
    await waitFor(() => {
      expect(sheet).not.toBeInTheDocument()
    })
  })

  it('add_sheet_items', async () => {
    const { user, router } = await renderShell('guardian')
    async function openSheet() {
      await user.click(
        within(tabBar()).getByRole('button', { name: ko.addSheet.open }),
      )
      return screen.findByRole('dialog', { name: ko.addSheet.title })
    }
    let sheet = await openSheet()
    const items = within(sheet)
      .getAllByRole('listitem')
      .map((li) => within(li).getByRole('button'))
    expect(items.map((b) => b.textContent)).toEqual([
      ko.addSheet.upload,
      ko.addSheet.story,
      ko.addSheet.growth,
      ko.addSheet.milestone,
    ])

    await user.click(
      within(sheet).getByRole('button', { name: ko.addSheet.story }),
    )
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/stories/new')
    })
    expect(sheet).not.toBeInTheDocument()

    // 키/몸무게, 마일스톤은 기록 시트 연결 전까지 아기 화면.
    await router.navigate({ to: '/' })
    sheet = await openSheet()
    await user.click(
      within(sheet).getByRole('button', { name: ko.addSheet.growth }),
    )
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/babies')
    })
    await router.navigate({ to: '/' })
    sheet = await openSheet()
    await user.click(
      within(sheet).getByRole('button', { name: ko.addSheet.milestone }),
    )
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/babies')
    })
  })

  // 데스크톱 사이드바도 휴대폰 (+) 와 같은 추가 시트.
  it('sidebar_opens_add_sheet', async () => {
    const { user, router } = await renderShell('guardian')
    const more = screen.getByRole('navigation', { name: ko.nav.more })
    const sidebar = more.parentElement
    if (!sidebar) throw new Error('사이드바 없음')
    expect(
      within(sidebar).queryByRole('button', { name: ko.nav.add }),
    ).toBeNull()
    await user.click(
      within(sidebar).getByRole('button', { name: ko.addSheet.open }),
    )
    const sheet = await screen.findByRole('dialog', {
      name: ko.addSheet.title,
    })
    // 셸에 시트 하나.
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    await user.click(
      within(sheet).getByRole('button', { name: ko.addSheet.story }),
    )
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/stories/new')
    })
  })

  // 이야기 쓰기와 고치기는 전체 화면(하단 탭 없음). 상세는 탭 유지.
  it('story_editor_hides_tab_bar', async () => {
    const story = storyFixture('s')
    const { router } = await renderShell('guardian', '/', [], {
      'GET /api/users': () => json(200, { users: [userFixture('guardian')] }),
      'GET /api/stories/s': () => json(200, story),
      'GET /api/stories/s/comments': () =>
        json(200, { items: [], next_cursor: null }),
    })
    expect(tabBar()).toBeInTheDocument()
    for (const href of ['/stories/new', '/stories/s/edit']) {
      await router.navigate({ href })
      await screen.findByRole('textbox', { name: ko.stories.body })
      expect(screen.queryByTestId('tab-bar')).toBeNull()
    }
    await router.navigate({ to: '/stories/$id', params: { id: 's' } })
    await screen.findByRole('button', { name: ko.stories.menu })
    expect(tabBar()).toBeInTheDocument()
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
