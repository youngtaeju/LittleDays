import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Baby, Role } from '@/api/types'
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
import { uploadStore } from './useUploadStore'

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
  uploadStore.reset()
  localStorage.clear()
  add.mockReset()
  vi.restoreAllMocks()
})

async function renderShell(babies: Baby[] = [B1], role: Role = 'guardian') {
  mockFetch({
    ...emptyFeedRoutes,
    'GET /api/babies': () => json(200, babies),
    'GET /api/auth/me': () => json(200, { user: userFixture(role) }),
    'GET /api/settings': () => json(200, settingsFixture),
  })
  const app = renderApp('/')
  await screen.findAllByText(settingsFixture.instance_name)
  return app
}

function fileInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[type=file]')
  if (!input) throw new Error('파일 입력 없음')
  return input
}

function jpg(name = 'a.jpg') {
  return new File(['x'], name, { type: 'image/jpeg', lastModified: 1 })
}
function mp4(name = 'v.mp4') {
  return new File(['x'], name, { type: 'video/mp4', lastModified: 1 })
}
// MIME 을 비워 보내는 브라우저.
function heic(name = 'h.heic') {
  return new File(['x'], name, { type: '', lastModified: 1 })
}

function confirmDialog(name: string) {
  return screen.findByRole('dialog', { name })
}

describe('UploadConfirm', () => {
  it('confirm_counts_title', async () => {
    const { user } = await renderShell()
    await user.upload(fileInput(), [jpg(), mp4(), heic(), jpg('b.jpg')])
    const dialog = await confirmDialog('사진 3장 · 영상 1개 올리기')
    expect(
      within(dialog).getByRole('button', { name: ko.upload.submit }),
    ).toBeInTheDocument()
    // 브라우저가 못 그리는 형식은 형식 표시.
    expect(within(dialog).getByText('HEIC')).toBeInTheDocument()
    await user.click(
      within(dialog).getByRole('button', { name: ko.common.cancel }),
    )

    // 0개 항목 생략.
    await user.upload(fileInput(), [mp4(), mp4('w.mp4')])
    expect(await confirmDialog('영상 2개 올리기')).toBeInTheDocument()
  })

  it('single_baby_auto_tag_hidden', async () => {
    const { user } = await renderShell([B1])
    const file = jpg()
    await user.upload(fileInput(), file)
    const dialog = await confirmDialog('사진 1장 올리기')
    expect(
      within(dialog).queryByRole('group', { name: ko.upload.babies }),
    ).toBeNull()
    await user.click(
      within(dialog).getByRole('button', { name: ko.upload.submit }),
    )
    await waitFor(() => {
      expect(add).toHaveBeenCalledWith([file], [B1.id])
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    // 같은 파일 다시 선택 허용.
    expect(fileInput().value).toBe('')
  })

  it('confirm_focuses_submit', async () => {
    const { user } = await renderShell([B1])
    await user.upload(fileInput(), [jpg(), jpg('b.jpg')])
    const dialog = await confirmDialog('사진 2장 올리기')
    // 첫 칸 ✕ 가 아닌 올리기. 실수로 Enter 를 눌러도 항목이 빠지지 않음.
    await waitFor(() => {
      expect(
        within(dialog).getByRole('button', { name: ko.upload.submit }),
      ).toHaveFocus()
    })
  })

  it('multi_baby_defaults_last', async () => {
    localStorage.setItem('ld.upload.babies', JSON.stringify([B2.id, 'gone']))
    const { user } = await renderShell([B1, B2])
    const file = jpg()
    await user.upload(fileInput(), file)
    const dialog = await confirmDialog('사진 1장 올리기')
    const group = within(dialog).getByRole('group', { name: ko.upload.babies })
    const chip1 = within(group).getByRole('button', { name: B1.name })
    const chip2 = within(group).getByRole('button', { name: B2.name })
    expect(chip1).toHaveAttribute('aria-pressed', 'false')
    expect(chip2).toHaveAttribute('aria-pressed', 'true')

    await user.click(chip1)
    expect(chip1).toHaveAttribute('aria-pressed', 'true')
    await user.click(
      within(dialog).getByRole('button', { name: ko.upload.submit }),
    )
    // 아기 표시 순서.
    await waitFor(() => {
      expect(add).toHaveBeenCalledWith([file], [B1.id, B2.id])
    })
    expect(localStorage.getItem('ld.upload.babies')).toBe(
      JSON.stringify([B1.id, B2.id]),
    )
  })

  it('remove_item', async () => {
    const { user } = await renderShell()
    const a = jpg()
    const b = jpg('b.jpg')
    await user.upload(fileInput(), [a, b])
    const dialog = await confirmDialog('사진 2장 올리기')
    await user.click(
      within(dialog).getByRole('button', {
        name: ko.upload.remove.replace('{{name}}', 'a.jpg'),
      }),
    )
    expect(await confirmDialog('사진 1장 올리기')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: ko.upload.submit }))
    await waitFor(() => {
      expect(add).toHaveBeenCalledWith([b], [B1.id])
    })

    // 마지막 항목을 빼면 닫힘.
    await user.upload(fileInput(), a)
    await user.click(
      within(await confirmDialog('사진 1장 올리기')).getByRole('button', {
        name: ko.upload.remove.replace('{{name}}', 'a.jpg'),
      }),
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(add).toHaveBeenCalledTimes(1)
  })

  it('cancel_uploads_nothing', async () => {
    const { user } = await renderShell()
    await user.upload(fileInput(), jpg())
    const dialog = await confirmDialog('사진 1장 올리기')
    await user.click(
      within(dialog).getByRole('button', { name: ko.common.cancel }),
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    // 지연 로딩 기회 후에도 업로드 없음.
    await act(() => Promise.resolve())
    expect(add).not.toHaveBeenCalled()
    expect(uploadStore.getSnapshot()).toEqual([])
  })

  it('object_urls_revoked', async () => {
    let n = 0
    const create = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation(() => `blob:${String(++n)}`)
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const { user } = await renderShell()
    await user.upload(fileInput(), [jpg(), mp4(), heic()])
    const dialog = await confirmDialog('사진 2장 · 영상 1개 올리기')
    // HEIC 는 미리보기 시도 없음.
    expect(create).toHaveBeenCalledTimes(2)
    const urls = create.mock.results.map((r) => String(r.value))

    await user.click(
      within(dialog).getByRole('button', {
        name: ko.upload.remove.replace('{{name}}', 'a.jpg'),
      }),
    )
    expect(revoke).toHaveBeenCalledWith(urls[0])

    await user.click(
      within(dialog).getByRole('button', { name: ko.upload.submit }),
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    for (const u of urls) expect(revoke).toHaveBeenCalledWith(u)
  })

  it('drop_opens_confirm', async () => {
    await renderShell()
    // 파일이 아닌 끌기(글자 등)는 무시.
    fireEvent.dragEnter(window, { dataTransfer: { types: ['text/plain'] } })
    expect(screen.queryByText(ko.upload.dropHere)).toBeNull()

    fireEvent.dragEnter(window, { dataTransfer: { types: ['Files'] } })
    expect(screen.getByText(ko.upload.dropHere)).toBeInTheDocument()
    fireEvent.dragLeave(window, { dataTransfer: { types: ['Files'] } })
    expect(screen.queryByText(ko.upload.dropHere)).toBeNull()

    fireEvent.dragEnter(window, { dataTransfer: { types: ['Files'] } })
    const drop = fireEvent.drop(window, {
      dataTransfer: { types: ['Files'], files: [jpg(), mp4()] },
    })
    // 브라우저가 파일을 열며 페이지를 떠나지 않도록 차단.
    expect(drop).toBe(false)
    expect(screen.queryByText(ko.upload.dropHere)).toBeNull()
    expect(
      await confirmDialog('사진 1장 · 영상 1개 올리기'),
    ).toBeInTheDocument()
  })

  it('in_page_drag_ignored', async () => {
    await renderShell()
    // 화면 안 사진 끌기(Chrome 은 Files 형식 포함).
    fireEvent.dragStart(window)
    fireEvent.dragEnter(window, { dataTransfer: { types: ['Files'] } })
    expect(screen.queryByText(ko.upload.dropHere)).toBeNull()
    const drop = fireEvent.drop(window, {
      dataTransfer: { types: ['Files'], files: [jpg()] },
    })
    expect(drop).toBe(false)
    await act(() => Promise.resolve())
    expect(screen.queryByRole('dialog')).toBeNull()

    // 끌기 끝나면 바깥 파일 놓기 다시 처리.
    fireEvent.dragEnd(window)
    fireEvent.dragEnter(window, { dataTransfer: { types: ['Files'] } })
    expect(screen.getByText(ko.upload.dropHere)).toBeInTheDocument()
  })

  it('drop_ignored_for_family', async () => {
    await renderShell([B1], 'family')
    fireEvent.dragEnter(window, { dataTransfer: { types: ['Files'] } })
    expect(screen.queryByText(ko.upload.dropHere)).toBeNull()
    const drop = fireEvent.drop(window, {
      dataTransfer: { types: ['Files'], files: [jpg()] },
    })
    expect(drop).toBe(false)
    await act(() => Promise.resolve())
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
