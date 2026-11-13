import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Role } from '@/api/types'
import { initI18n } from '@/i18n'
import ko from '@/locales/ko.json'
import { json, mockFetch } from '@/test/fetch'
import { emptyFeedRoutes, settingsFixture, userFixture } from '@/test/fixtures'
import { renderApp } from '@/test/router'

beforeEach(() => {
  initI18n('ko')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderShell(role: Role, path = '/') {
  mockFetch({
    ...emptyFeedRoutes,
    'GET /api/auth/me': () => json(200, { user: userFixture(role) }),
    'GET /api/settings': () => json(200, settingsFixture),
    'GET /api/trash': () => json(200, { items: [], next_cursor: null }),
  })
  return renderApp(path)
}

// 주 메뉴가 둘(하단 탭, 사이드바). 하단 탭이 아닌 쪽의 부모.
async function sidebar() {
  const navs = await screen.findAllByRole('navigation', { name: ko.nav.main })
  const main = navs.find((n) => n.dataset.testid !== 'tab-bar')
  const el = main?.parentElement
  if (!main || !el) throw new Error('사이드바 없음')
  return { main: within(main), root: within(el) }
}

describe('Sidebar', () => {
  it('sidebar_items', async () => {
    renderShell('guardian')
    let { main, root } = await sidebar()
    expect(main.getAllByRole('link').map((l) => l.textContent)).toEqual([
      ko.nav.home,
      ko.nav.calendar,
      ko.nav.albums,
      ko.nav.me,
    ])
    expect(
      root.getByRole('button', { name: ko.addSheet.open }),
    ).toBeInTheDocument()
    const more = within(root.getByRole('navigation', { name: ko.nav.more }))
    expect(more.getAllByRole('link').map((l) => l.textContent)).toEqual([
      ko.nav.trash,
    ])
    expect(more.getByRole('link', { name: ko.nav.trash })).toHaveAttribute(
      'href',
      '/me/trash',
    )
    cleanup()

    // 가족: 주 메뉴만. 보조 메뉴, 추가하기 없음.
    renderShell('family')
    ;({ main, root } = await sidebar())
    expect(main.getAllByRole('link')).toHaveLength(4)
    expect(root.queryByRole('navigation', { name: ko.nav.more })).toBeNull()
    expect(root.queryByRole('button', { name: ko.addSheet.open })).toBeNull()
  })

  // 보조 메뉴 주소에서는 그 항목만 선택(나 표시 없음).
  it('sidebar_single_current_on_secondary', async () => {
    const { router } = renderShell('guardian', '/me/trash')
    const { root } = await sidebar()
    await screen.findByRole('heading', { level: 1, name: ko.nav.trash })
    await waitFor(() => {
      expect(router.state.status).toBe('idle')
    })
    const current = root
      .getAllByRole('link')
      .filter((l) => l.getAttribute('aria-current') === 'page')
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveAccessibleName(ko.nav.trash)
  })
})
