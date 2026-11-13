import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Baby, Role } from '@/api/types'
import { meQueryKey } from '@/auth/session'
import { initI18n } from '@/i18n'
import ko from '@/locales/ko.json'
import { json, mockFetch } from '@/test/fetch'
import {
  babyFixture,
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
  localStorage.clear()
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
  // 달력, 앨범 화면은 자체 머리글. 휴대폰 셸 머리글(우리 집 이름) 숨김.
  it('own_header_routes', async () => {
    const { router } = await renderShell('guardian', '/me', [], {
      'GET /api/favorites': () => json(200, { items: [], next_cursor: null }),
      'GET /api/assets': () => json(200, { items: [], next_cursor: null }),
      'GET /api/albums': () => json(200, []),
    })
    // 하위 화면 자체 머리글(header)도 banner. 셸 머리글이 문서 순서상 먼저.
    const shellTitle = () => {
      const [shell] = screen.getAllByRole('banner')
      if (!shell) throw new Error('셸 머리글 없음')
      return within(shell).getByText(settingsFixture.instance_name)
    }
    expect(shellTitle().closest('.hidden')).toBeNull()
    for (const href of [
      '/calendar',
      '/albums',
      '/albums/favorites',
      '/albums/videos',
    ]) {
      await router.navigate({ href })
      await waitFor(() => {
        expect(router.state.status).toBe('idle')
      })
      expect(shellTitle().closest('.hidden')).not.toBeNull()
    }
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
    const sky = babyFixture()
    const sea = babyFixture({
      id: '00000000-0000-4000-8000-0000000000b2',
      name: '바다',
      birth_date: '2025-06-01',
      sort_order: 1,
    })
    const due = babyFixture({
      id: '00000000-0000-4000-8000-0000000000b3',
      name: '별',
      birth_date: '2099-01-01',
      sort_order: 2,
    })
    // 마지막으로 본 아기가 기본 선택.
    localStorage.setItem('ld.baby.last', sea.id)
    const { user, router } = await renderShell(
      'guardian',
      '/',
      [sky, sea, due],
      {
        [`GET /api/babies/${sea.id}/milestones`]: () => json(200, []),
        [`GET /api/babies/${sky.id}/milestones`]: () => json(200, []),
      },
    )
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

    // 키/몸무게는 기록 시트. 태어나지 않은 아기는 고를 수 없음.
    await router.navigate({ to: '/' })
    sheet = await openSheet()
    await user.click(
      within(sheet).getByRole('button', { name: ko.addSheet.growth }),
    )
    const growth = await screen.findByRole('dialog', {
      name: ko.growth.newTitle,
    })
    const picker = within(growth).getByRole('radiogroup', {
      name: ko.growth.baby,
    })
    const radios = within(picker).getAllByRole('radio')
    expect(radios.map((r) => r.textContent)).toEqual(['하늘', '바다'])
    expect(within(picker).getByRole('radio', { name: '바다' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(router.state.location.pathname).toBe('/')
    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(growth).not.toBeInTheDocument()
    })

    // 마일스톤은 고르기 시트. 아기 고르기는 키/몸무게와 같은 규칙.
    sheet = await openSheet()
    await user.click(
      within(sheet).getByRole('button', { name: ko.addSheet.milestone }),
    )
    const milestone = await screen.findByRole('dialog', {
      name: ko.milestones.pickerTitle,
    })
    const babyRadios = within(milestone).getByRole('radiogroup', {
      name: ko.milestones.baby,
    })
    expect(
      within(babyRadios)
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['하늘', '바다'])
    expect(
      within(babyRadios).getByRole('radio', { name: '바다' }),
    ).toHaveAttribute('aria-checked', 'true')
    expect(
      await within(milestone).findByRole('button', {
        name: ko.milestones.custom,
      }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
  })

  // 태어난 아기가 없으면 키/몸무게, 마일스톤 항목 없음.
  it('add_sheet_hides_records_without_born_baby', async () => {
    const due = babyFixture({ birth_date: '2099-01-01' })
    const { user } = await renderShell('guardian', '/', [due])
    await user.click(
      within(tabBar()).getByRole('button', { name: ko.addSheet.open }),
    )
    const sheet = await screen.findByRole('dialog', {
      name: ko.addSheet.title,
    })
    await waitFor(() => {
      expect(
        within(sheet).queryByRole('button', { name: ko.addSheet.growth }),
      ).not.toBeInTheDocument()
    })
    expect(
      within(sheet).queryByRole('button', { name: ko.addSheet.milestone }),
    ).not.toBeInTheDocument()
    expect(
      within(sheet).getByRole('button', { name: ko.addSheet.story }),
    ).toBeInTheDocument()
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
