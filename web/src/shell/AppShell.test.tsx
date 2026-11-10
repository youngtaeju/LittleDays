import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Baby, Role } from '@/api/types'
import { meQueryKey } from '@/auth/session'
import { initI18n } from '@/i18n'
import ko from '@/locales/ko.json'
import { json, mockFetch } from '@/test/fetch'
import {
  babyFixture,
  emptyTimelineRoutes,
  settingsFixture,
  userFixture,
} from '@/test/fixtures'
import { renderApp } from '@/test/router'
import { uploadStore } from '@/upload/useUploadStore'

const add = vi.fn()
vi.mock('@/upload/uploader', () => ({
  getUploader: () => ({ add, retry: vi.fn() }),
}))

beforeEach(() => {
  initI18n('ko')
})

afterEach(() => {
  cleanup()
  uploadStore.reset()
  add.mockReset()
  vi.restoreAllMocks()
})

async function renderShell(role: Role, path = '/', babies: Baby[] = []) {
  mockFetch({
    ...emptyTimelineRoutes,
    'GET /api/babies': () => json(200, babies),
    'GET /api/auth/me': () => json(200, { user: userFixture(role) }),
    'GET /api/settings': () => json(200, settingsFixture),
    'GET /api/auth/status': () => json(200, { signup_open: false }),
    'GET /api/auth/sessions': () => json(200, { sessions: [] }),
    'POST /api/auth/logout': () => json(204, null),
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

  it('picked_files_upload_with_single_baby', async () => {
    const { user } = await renderShell('guardian', '/', [babyFixture()])
    const input = document.querySelector<HTMLInputElement>('input[type=file]')
    if (!input) throw new Error('파일 입력 없음')
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' })
    await user.upload(input, file)
    await waitFor(() => {
      expect(add).toHaveBeenCalledWith([file], [babyFixture().id])
    })
    // 같은 파일 다시 선택 허용.
    expect(input.value).toBe('')
  })

  it('picked_files_untagged_with_many_babies', async () => {
    const { user } = await renderShell('guardian', '/', [
      babyFixture(),
      babyFixture({ id: '00000000-0000-4000-8000-0000000000b2', name: '바다' }),
    ])
    const input = document.querySelector<HTMLInputElement>('input[type=file]')
    if (!input) throw new Error('파일 입력 없음')
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' })
    await user.upload(input, file)
    await waitFor(() => {
      expect(add).toHaveBeenCalledWith([file], [])
    })
  })

  it('add_badge_counts_active_uploads', async () => {
    uploadStore.put({
      id: 'f1',
      name: 'a.jpg',
      status: 'uploading',
      progress: 0,
    })
    uploadStore.put({ id: 'f2', name: 'b.jpg', status: 'done', progress: 1 })
    await renderShell('guardian')
    const label = `${ko.nav.add}, ${ko.upload.inProgress.replace('{{count}}', '1')}`
    expect(
      within(tabBar()).getByRole('button', { name: label }),
    ).toBeInTheDocument()
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
