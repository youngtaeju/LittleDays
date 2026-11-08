import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Role, Settings, TrashItem } from '@/api/types'
import { initI18n } from '@/i18n'
import { json, mockFetch } from '@/test/fetch'
import {
  assetFixture,
  assetSummaryFixture,
  emptyTimelineRoutes,
  settingsFixture,
  userFixture,
} from '@/test/fixtures'
import { renderApp } from '@/test/router'

beforeEach(() => {
  initI18n('ko')
})

afterEach(cleanup)

const ID = '00000000-0000-4000-8000-0000000000a1'

function trashItem(id = ID): TrashItem {
  return {
    ...assetSummaryFixture(id),
    deleted_at: '2024-06-01T03:00:00Z',
  }
}

function renderTrash(
  items: TrashItem[],
  extra: Parameters<typeof mockFetch>[0] = {},
  {
    role = 'guardian',
    settings = settingsFixture,
  }: { role?: Role; settings?: Settings } = {},
) {
  mockFetch({
    'GET /api/auth/me': () => json(200, { user: userFixture(role) }),
    'GET /api/settings': () => json(200, settings),
    'GET /api/trash': () => json(200, { items, next_cursor: null }),
    ...emptyTimelineRoutes,
    ...extra,
  })
  return renderApp('/trash')
}

describe('TrashPage', () => {
  it('retention_notice', async () => {
    renderTrash(
      [],
      {},
      { settings: { ...settingsFixture, trash_retention_days: 0 } },
    )
    expect(
      await screen.findByText('휴지통을 자동으로 비우지 않아요.'),
    ).toBeInTheDocument()
    cleanup()

    renderTrash(
      [],
      {},
      { settings: { ...settingsFixture, trash_retention_days: 30 } },
    )
    expect(await screen.findByText(/30일/)).toBeInTheDocument()
  })

  it('restore_item', async () => {
    let restored = false
    const posts: string[] = []
    const { user } = renderTrash([trashItem()], {
      'GET /api/trash': () =>
        json(200, { items: restored ? [] : [trashItem()], next_cursor: null }),
      [`POST /api/assets/${ID}/restore`]: () => {
        restored = true
        posts.push(ID)
        return json(200, assetFixture(ID))
      },
    })
    await user.click(await screen.findByRole('button', { name: /^사진/ }))
    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByText(/삭제 시각/)).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: '복구' }))

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^사진/ })).toBeNull()
    })
    expect(posts).toEqual([ID])
    expect(await screen.findByText('휴지통이 비어 있어요.')).toBeInTheDocument()
  })

  it('permanent_requires_confirm', async () => {
    const deletes: string[] = []
    const { user } = renderTrash([trashItem()], {
      [`DELETE /api/assets/${ID}/permanent`]: () => {
        deletes.push(ID)
        return json(204, null)
      },
      'GET /api/babies': () => json(200, []),
    })
    await user.click(await screen.findByRole('button', { name: /^사진/ }))
    const sheet = await screen.findByRole('dialog')
    await user.click(within(sheet).getByRole('button', { name: '영구 삭제' }))

    const confirm = await screen.findByText('영구 삭제할까요?')
    expect(deletes).toEqual([])
    const dialog = confirm.closest('[role="dialog"]') as HTMLElement
    await user.click(within(dialog).getByRole('button', { name: '영구 삭제' }))
    await waitFor(() => {
      expect(deletes).toEqual([ID])
    })
  })

  it('empty_trash_reports_count', async () => {
    const { user } = renderTrash([trashItem()], {
      'POST /api/trash/empty': () => json(200, { deleted: 3 }),
      'GET /api/babies': () => json(200, []),
    })
    await user.click(
      await screen.findByRole('button', { name: '휴지통 비우기' }),
    )
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/1개/)).toBeInTheDocument()
    await user.click(
      within(dialog).getByRole('button', { name: '휴지통 비우기' }),
    )
    expect(await screen.findByText('3개 영구 삭제함')).toBeInTheDocument()
  })

  it('family_redirected', async () => {
    const { router } = renderTrash([], {}, { role: 'family' })
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/')
    })
  })
})
