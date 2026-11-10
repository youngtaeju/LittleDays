import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent, { PointerEventsCheckLevel } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '@/i18n'
import ko from '@/locales/ko.json'
import { json, mockFetch } from '@/test/fetch'
import {
  babyFixture,
  emptyFeedRoutes,
  settingsFixture,
  userFixture,
} from '@/test/fixtures'
import { renderApp } from '@/test/router'
import {
  restorePendingUploads,
  uploadStore,
  type UploadItem,
} from './useUploadStore'

const add = vi.fn()
vi.mock('./uploader', () => ({
  getUploader: () => ({ add, retry: vi.fn() }),
}))

const B1 = babyFixture()
const B2 = babyFixture({
  id: '00000000-0000-4000-8000-0000000000b2',
  name: '바다',
})

beforeEach(() => {
  initI18n('ko')
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  uploadStore.reset()
  localStorage.clear()
  add.mockReset()
  vi.restoreAllMocks()
})

async function renderShell(path = '/') {
  mockFetch({
    ...emptyFeedRoutes,
    'GET /api/babies': () => json(200, [B1, B2]),
    'GET /api/auth/me': () => json(200, { user: userFixture('guardian') }),
    'GET /api/settings': () => json(200, settingsFixture),
    'GET /api/auth/status': () => json(200, { signup_open: false }),
    'GET /api/auth/sessions': () => json(200, { sessions: [] }),
    'GET /api/invites': () => json(200, { invites: [] }),
    'POST /api/auth/logout': () => json(204, null),
  })
  const app = renderApp(path)
  await screen.findAllByText(settingsFixture.instance_name)
  return app
}

function item(id: string, over: Partial<UploadItem> = {}): UploadItem {
  return { id, name: `${id}.jpg`, status: 'queued', progress: 0, ...over }
}

function pill(name: string | RegExp) {
  return screen.getByRole('button', { name })
}

const resume = (babyIds: string[]) => ({
  size: 1,
  lastModified: 1,
  babyIds,
})

describe('UploadPill', () => {
  it('pill_states', async () => {
    const { user } = await renderShell()
    expect(screen.queryByRole('button', { name: /올리는 중/ })).toBeNull()

    // 진행: 묶음 전체 개수와 평균 진행률.
    act(() => {
      uploadStore.startRun()
      uploadStore.put(item('f1', { status: 'uploading', progress: 0.5 }))
      uploadStore.put(item('f2'))
    })
    expect(pill('2개 올리는 중 · 25%')).toBeInTheDocument()

    // 완료: 3초 후 사라짐.
    vi.useFakeTimers()
    act(() => {
      uploadStore.patch('f1', { status: 'done', progress: 1 })
      uploadStore.patch('f2', { status: 'duplicate', progress: 1 })
    })
    expect(pill('2개 올렸어요')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(screen.queryByRole('button', { name: '2개 올렸어요' })).toBeNull()

    // 실패: 누를 때까지 유지.
    act(() => {
      uploadStore.startRun()
      uploadStore.put(item('f3', { status: 'uploading', progress: 0.1 }))
    })
    act(() => {
      uploadStore.patch('f3', { status: 'error' })
    })
    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    vi.useRealTimers()
    await user.click(pill('1개를 못 올렸어요'))
    const sheet = await screen.findByRole('dialog', { name: ko.upload.queue })
    expect(within(sheet).getByText('3개 중 3개 완료, 실패 1개')).toBeVisible()
    await user.click(
      within(sheet).getByRole('button', { name: ko.common.close }),
    )
    expect(
      screen.queryByRole('button', { name: '1개를 못 올렸어요' }),
    ).toBeNull()

    // 이어올리기 대기.
    act(() => {
      uploadStore.put(item('f4', { status: 'resumable', resume: resume([]) }))
    })
    expect(pill('이어서 올릴 사진 1개')).toBeInTheDocument()
  })

  it('failure_survives_new_upload', async () => {
    const { user } = await renderShell()
    act(() => {
      uploadStore.startRun()
      uploadStore.put(item('f1', { status: 'uploading', progress: 0.5 }))
    })
    act(() => {
      uploadStore.patch('f1', { status: 'error' })
    })
    expect(pill('1개를 못 올렸어요')).toBeInTheDocument()

    // 누르지 않은 실패는 새 업로드 완료(3초) 후 다시 표시.
    vi.useFakeTimers()
    act(() => {
      uploadStore.startRun()
      uploadStore.put(item('f2', { status: 'uploading', progress: 0.5 }))
    })
    expect(pill('1개 올리는 중 · 50%')).toBeInTheDocument()
    act(() => {
      uploadStore.patch('f2', { status: 'done', progress: 1 })
    })
    expect(pill('1개 올렸어요')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    vi.useRealTimers()
    await user.click(pill('1개를 못 올렸어요'))
    const sheet = await screen.findByRole('dialog', { name: ko.upload.queue })
    await user.click(
      within(sheet).getByRole('button', { name: ko.common.close }),
    )
    expect(screen.queryByRole('button', { name: /못 올렸어요/ })).toBeNull()

    // 확인한 실패도 다시 시도 후 또 실패하면 다시 표시.
    act(() => {
      uploadStore.patch('f1', { status: 'queued', error: undefined })
    })
    act(() => {
      uploadStore.patch('f1', { status: 'error' })
    })
    expect(pill('1개를 못 올렸어요')).toBeInTheDocument()
  })

  it('trash_duplicate_needs_attention', async () => {
    const { user } = await renderShell()
    vi.useFakeTimers()
    act(() => {
      uploadStore.startRun()
      uploadStore.put(item('f1', { status: 'uploading', progress: 0.5 }))
    })
    act(() => {
      uploadStore.patch('f1', {
        status: 'duplicate',
        assetId: 'a1',
        inTrash: true,
        progress: 1,
      })
    })
    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    vi.useRealTimers()
    await user.click(pill('휴지통에 있는 사진 1개'))
    const sheet = await screen.findByRole('dialog', { name: ko.upload.queue })
    expect(within(sheet).getByText(ko.upload.status.inTrash)).toBeVisible()
    await user.click(
      within(sheet).getByRole('button', { name: ko.common.close }),
    )
    expect(screen.queryByRole('button', { name: /휴지통/ })).toBeNull()

    // 휴지통 밖 중복은 완료.
    act(() => {
      uploadStore.startRun()
      uploadStore.put(item('f2', { status: 'uploading', progress: 0.5 }))
    })
    act(() => {
      uploadStore.patch('f2', {
        status: 'duplicate',
        assetId: 'a2',
        inTrash: false,
        progress: 1,
      })
    })
    expect(pill('1개 올렸어요')).toBeInTheDocument()
  })

  it('pill_persists_across_tabs', async () => {
    uploadStore.startRun()
    uploadStore.put(item('f1', { status: 'uploading', progress: 0.4 }))
    const { user } = await renderShell()
    const label = '1개 올리는 중 · 40%'
    expect(pill(label)).toBeInTheDocument()
    const nav = screen.getByTestId('tab-bar')
    for (const name of [ko.nav.babies, ko.nav.family, ko.nav.me]) {
      await user.click(within(nav).getByRole('link', { name }))
      expect(pill(label)).toBeInTheDocument()
    }
  })

  it('resumable_after_reload', async () => {
    // 새로고침 전 저장된 진행 중 파일 2개(태그 다름).
    localStorage.setItem(
      'ld.upload.pending',
      JSON.stringify([
        { id: 'f1', name: 'a.jpg', ...resume([B2.id]) },
        { id: 'f2', name: 'b.jpg', ...resume([B1.id, 'gone']) },
      ]),
    )
    restorePendingUploads()
    const { user } = await renderShell()
    await user.click(pill('이어서 올릴 사진 2개'))
    const sheet = await screen.findByRole('dialog', { name: ko.upload.queue })
    expect(within(sheet).getByText(ko.upload.resumeHint)).toBeVisible()

    const click = vi.spyOn(HTMLInputElement.prototype, 'click')
    await user.click(
      within(sheet).getByRole('button', { name: ko.upload.repick }),
    )
    const input = click.mock.contexts[0]
    if (!(input instanceof HTMLInputElement)) throw new Error('파일 입력 없음')
    click.mockRestore()

    // 같은 파일은 확인 없이 원래 태그로(지운 아기 제외). 다른 파일은 확인 시트.
    const a = new File(['x'], 'a.jpg', { type: 'image/jpeg', lastModified: 1 })
    const b = new File(['x'], 'b.jpg', { type: 'image/jpeg', lastModified: 1 })
    const other = new File(['y'], 'c.jpg', {
      type: 'image/jpeg',
      lastModified: 1,
    })
    // 시트가 열린 동안 본문은 pointer-events: none. 실제 선택창은 프로그램 click 이라 무관.
    await userEvent
      .setup({ pointerEventsCheck: PointerEventsCheckLevel.Never })
      .upload(input, [a, b, other])
    await waitFor(() => {
      expect(add).toHaveBeenCalledWith([a], [B2.id])
    })
    expect(add).toHaveBeenCalledWith([b], [B1.id])
    expect(add).toHaveBeenCalledTimes(2)
    expect(
      await screen.findByRole('dialog', { name: '사진 1장 올리기' }),
    ).toBeInTheDocument()
  })

  it('discard_resumable', async () => {
    uploadStore.put(item('f1', { status: 'resumable', resume: resume([]) }))
    const { user } = await renderShell()
    await user.click(pill('이어서 올릴 사진 1개'))
    const sheet = await screen.findByRole('dialog', { name: ko.upload.queue })
    await user.click(
      within(sheet).getByRole('button', { name: ko.upload.discard }),
    )
    expect(uploadStore.getSnapshot()).toEqual([])
    expect(localStorage.getItem('ld.upload.pending')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('button', { name: /이어서/ })).toBeNull()
  })

  it('legacy_upload_opens_queue', async () => {
    uploadStore.put(item('f1', { status: 'error' }))
    const { router } = await renderShell('/upload')
    await waitFor(() => {
      expect(router.state.location.href).toBe('/')
    })
    expect(
      await screen.findByRole('dialog', { name: ko.upload.queue }),
    ).toBeInTheDocument()
    cleanup()
    uploadStore.reset()

    // 큐가 비면 시트 없이 홈.
    const empty = await renderShell('/upload')
    await waitFor(() => {
      expect(empty.router.state.location.href).toBe('/')
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('logout_hides_pill', async () => {
    uploadStore.startRun()
    uploadStore.put(item('f1', { status: 'uploading', progress: 0.4 }))
    const { user, router } = await renderShell('/me')
    expect(pill('1개 올리는 중 · 40%')).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: ko.nav.logout }))
    await waitFor(() => {
      expect(router.state.location.href).toBe('/login')
    })
    expect(uploadStore.getSnapshot()).toEqual([])
    expect(screen.queryByRole('button', { name: /올리는 중/ })).toBeNull()
  })
})
