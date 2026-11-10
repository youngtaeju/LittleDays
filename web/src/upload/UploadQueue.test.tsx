import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '@/i18n'
import ko from '@/locales/ko.json'
import { json, mockFetch } from '@/test/fetch'
import {
  assetFixture,
  babyFixture,
  emptyTimelineRoutes,
  settingsFixture,
  userFixture,
} from '@/test/fixtures'
import { renderApp } from '@/test/router'
import { uploadStore } from './useUploadStore'

const retry = vi.fn()
vi.mock('./uploader', () => ({
  getUploader: () => ({ add: vi.fn(), retry }),
}))

beforeEach(() => {
  initI18n('ko')
})

afterEach(() => {
  // 구독 컴포넌트 해제 후 초기화. 마운트 중 초기화는 act 밖 갱신.
  cleanup()
  uploadStore.reset()
  retry.mockReset()
  vi.restoreAllMocks()
})

type Routes = Parameters<typeof mockFetch>[0]

// 큐는 셸 위쪽 패널. 홈에서 확인.
function renderUpload(opts: { extra?: Routes } = {}) {
  mockFetch({
    ...emptyTimelineRoutes,
    'GET /api/auth/me': () => json(200, { user: userFixture('guardian') }),
    'GET /api/settings': () => json(200, settingsFixture),
    'GET /api/babies': () => json(200, [babyFixture()]),
    ...opts.extra,
  })
  return renderApp('/')
}

async function waitReady() {
  await screen.findByRole('list', { name: ko.upload.queue })
}

describe('UploadQueue', () => {
  it('duplicate_in_trash_offers_restore', async () => {
    uploadStore.put({
      id: 'f1',
      name: 'IMG_0001.JPG',
      status: 'duplicate',
      assetId: 'a1',
      inTrash: true,
      progress: 1,
    })
    let restoreReq: Request | undefined
    const { user } = renderUpload({
      extra: {
        'POST /api/assets/a1/restore': (r) => {
          restoreReq = r
          return json(200, assetFixture('a1'))
        },
      },
    })
    await waitReady()
    const queue = screen.getByRole('list', { name: ko.upload.queue })
    const row = within(queue).getByRole('listitem')
    expect(within(row).getByText(ko.upload.status.inTrash)).toBeInTheDocument()

    await user.click(
      within(row).getByRole('button', { name: ko.upload.restore }),
    )
    expect(await within(row).findByText(ko.upload.restored)).toBeInTheDocument()
    expect(restoreReq?.headers.get('X-Requested-With')).toBe('LittleDays')
    expect(
      within(row).queryByRole('button', { name: ko.upload.restore }),
    ).toBeNull()
  })

  it('queue_single_live_region', async () => {
    uploadStore.put({ id: 'f1', name: 'a.jpg', status: 'done', progress: 1 })
    uploadStore.put({
      id: 'f2',
      name: 'b.jpg',
      status: 'uploading',
      progress: 0.5,
    })
    uploadStore.put({
      id: 'f3',
      name: 'c.jpg',
      status: 'duplicate',
      assetId: 'a3',
      inTrash: false,
      progress: 1,
    })
    renderUpload()
    await waitReady()
    const queue = screen.getByRole('list', { name: ko.upload.queue })
    const summary = screen.getByText('3개 중 2개 완료')
    expect(summary).toHaveAttribute('role', 'status')
    expect(queue.querySelector('[aria-live]')).toBeNull()
    // 행 버튼은 파일 이름으로 보충 설명.
    const link = screen.getByRole('link', { name: ko.upload.view })
    expect(link).toHaveAccessibleDescription('c.jpg')
  })

  it('queue_summary_reports_failures', async () => {
    uploadStore.put({ id: 'f1', name: 'a.jpg', status: 'done', progress: 1 })
    uploadStore.put({ id: 'f2', name: 'b.jpg', status: 'error', progress: 0 })
    uploadStore.put({
      id: 'f3',
      name: 'c.jpg',
      status: 'unsupported',
      progress: 0,
    })
    uploadStore.put({
      id: 'f4',
      name: 'd.jpg',
      status: 'duplicate',
      assetId: 'a4',
      inTrash: false,
      progress: 1,
    })
    renderUpload()
    await waitReady()
    expect(screen.getByText('4개 중 4개 완료, 실패 2개')).toHaveAttribute(
      'role',
      'status',
    )
  })

  it('duplicate_links_to_existing', async () => {
    uploadStore.put({
      id: 'f1',
      name: 'IMG_0001.JPG',
      status: 'duplicate',
      assetId: 'a1',
      inTrash: false,
      progress: 1,
    })
    renderUpload()
    await waitReady()
    expect(screen.getByText(ko.upload.status.duplicate)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: ko.upload.view })).toHaveAttribute(
      'href',
      '/photos/a1',
    )
  })

  it('uploading_shows_progress', async () => {
    uploadStore.put({
      id: 'f1',
      name: 'IMG_0001.JPG',
      status: 'uploading',
      progress: 0.42,
    })
    renderUpload()
    await waitReady()
    expect(
      screen.getByRole('progressbar', { name: 'IMG_0001.JPG' }),
    ).toHaveAttribute('aria-valuenow', '42')
  })

  it('retry_loads_uploader', async () => {
    uploadStore.put({ id: 'f1', name: 'a.jpg', status: 'error', progress: 0 })
    const { user } = renderUpload()
    await waitReady()
    await user.click(screen.getByRole('button', { name: ko.common.retry }))
    await waitFor(() => {
      expect(retry).toHaveBeenCalledWith('f1')
    })
  })
})
