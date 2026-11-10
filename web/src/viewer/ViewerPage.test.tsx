import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Asset, AssetSummary, Baby, Role } from '@/api/types'
import { initI18n } from '@/i18n'
import ko from '@/locales/ko.json'
import { json, mockFetch } from '@/test/fetch'
import {
  assetFixture,
  assetSummaryFixture,
  babyFixture,
  dayFixture,
  settingsFixture,
  userFixture,
} from '@/test/fixtures'
import { renderApp } from '@/test/router'

beforeEach(() => {
  initI18n('ko')
  // jsdom 은 canvas 미구현. 미구현 경고 출력 방지.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => null,
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

type Routes = Parameters<typeof mockFetch>[0]

// 목록 [ids] 와 각 상세. 상세는 assets 로 덮어씀.
function renderViewer(opts: {
  path: string
  ids?: string[]
  role?: Role
  babies?: Baby[]
  assets?: Record<string, Asset>
  list?: () => AssetSummary[]
  extra?: Routes
}) {
  const ids = opts.ids ?? ['a', 'b', 'c']
  const detail: Routes = {}
  for (const id of ids) {
    detail[`GET /api/assets/${id}`] = () =>
      json(200, opts.assets?.[id] ?? assetFixture(id))
  }
  mockFetch({
    'GET /api/auth/me': () =>
      json(200, { user: userFixture(opts.role ?? 'guardian') }),
    'GET /api/settings': () => json(200, settingsFixture),
    'GET /api/babies': () => json(200, opts.babies ?? [babyFixture()]),
    'GET /api/assets': () =>
      json(200, {
        items: opts.list?.() ?? ids.map((id) => assetSummaryFixture(id)),
        next_cursor: null,
      }),
    // 홈으로 닫을 때. 목록 앞 3장이 대표.
    'GET /api/days': () =>
      json(200, {
        items: [
          dayFixture('2024-05-10', {
            photo_count: ids.length,
            preview: ids.slice(0, 3).map((id) => assetSummaryFixture(id)),
          }),
        ],
        next_cursor: null,
      }),
    'GET /api/users': () => json(200, { users: [userFixture('guardian')] }),
    ...detail,
    ...opts.extra,
  })
  return renderApp(opts.path)
}

async function openInfo() {
  const button = await screen.findByRole('button', { name: ko.viewer.info })
  fireEvent.click(button)
  return screen.findByRole('dialog', { name: ko.viewer.info })
}

describe('ViewerPage', () => {
  it('shows_avif_source_only_when_listed', async () => {
    renderViewer({
      path: '/photos/a',
      ids: ['a'],
      list: () => [
        assetSummaryFixture('a', {
          derivatives: {
            preview: { formats: ['webp'], width: 1600, height: 1200 },
          },
        }),
      ],
      assets: {
        a: assetFixture('a', {
          derivatives: {
            preview: { formats: ['webp'], width: 1600, height: 1200 },
          },
        }),
      },
    })
    await waitFor(() => {
      expect(
        document.querySelector('img[src="/api/assets/a/preview.webp"]'),
      ).not.toBeNull()
    })
    await screen.findByRole('button', { name: ko.viewer.info })
    expect(document.querySelector('source[type="image/avif"]')).toBeNull()
    cleanup()

    renderViewer({
      path: '/photos/a',
      ids: ['a'],
      assets: {
        a: assetFixture('a', {
          derivatives: {
            preview: { formats: ['webp', 'avif'], width: 1600, height: 1200 },
          },
        }),
      },
    })
    await waitFor(() => {
      expect(
        document.querySelector('source[type="image/avif"]'),
      ).toHaveAttribute('srcset', '/api/assets/a/preview.avif')
    })
  })

  it('swipe_and_keys_navigate', async () => {
    const { router, user } = renderViewer({ path: '/photos/b' })
    const stage = await screen.findByRole('main')
    await waitFor(() => {
      expect(
        document.querySelector('img[src="/api/assets/b/preview.webp"]'),
      ).not.toBeNull()
    })

    await user.keyboard('{ArrowRight}')
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/photos/c')
    })

    await user.keyboard('{ArrowLeft}')
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/photos/b')
    })
    await user.keyboard('{ArrowLeft}')
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/photos/a')
    })

    // 왼쪽으로 밀기 → 다음.
    fireEvent.pointerDown(stage, { pointerId: 1, clientX: 300, clientY: 200 })
    fireEvent.pointerUp(stage, { pointerId: 1, clientX: 200, clientY: 210 })
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/photos/b')
    })

    // 오른쪽으로 밀기 → 이전.
    fireEvent.pointerDown(stage, { pointerId: 1, clientX: 100, clientY: 200 })
    fireEvent.pointerUp(stage, { pointerId: 1, clientX: 200, clientY: 200 })
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/photos/a')
    })

    // 60px 미만 또는 세로가 더 큰 이동은 무시.
    fireEvent.pointerDown(stage, { pointerId: 1, clientX: 300, clientY: 200 })
    fireEvent.pointerUp(stage, { pointerId: 1, clientX: 250, clientY: 200 })
    fireEvent.pointerDown(stage, { pointerId: 1, clientX: 300, clientY: 100 })
    fireEvent.pointerUp(stage, { pointerId: 1, clientX: 200, clientY: 300 })
    await new Promise((r) => setTimeout(r, 50))
    expect(router.state.location.pathname).toBe('/photos/a')
  })

  it('loads_next_page_at_list_end', async () => {
    const cursors: (string | null)[] = []
    const { router, user } = renderViewer({
      path: '/photos/b',
      extra: {
        'GET /api/assets': (req) => {
          const cursor = new URL(req.url).searchParams.get('cursor')
          cursors.push(cursor)
          return cursor === 'c1'
            ? json(200, {
                items: [assetSummaryFixture('c')],
                next_cursor: null,
              })
            : json(200, {
                items: [assetSummaryFixture('a'), assetSummaryFixture('b')],
                next_cursor: 'c1',
              })
        },
      },
    })

    await waitFor(() => {
      expect(cursors).toEqual([null, 'c1'])
    })
    await user.keyboard('{ArrowRight}')
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/photos/c')
    })
    expect(cursors).toEqual([null, 'c1'])
  })

  it('finds_neighbors_beyond_first_page', async () => {
    const first = Array.from({ length: 100 }, (_, i) =>
      assetSummaryFixture(`p${String(i)}`),
    )
    const second = ['z1', 'z2', 'z3'].map((id) => assetSummaryFixture(id))
    const { router, user } = renderViewer({
      path: '/photos/z2',
      ids: ['z1', 'z2', 'z3'],
      extra: {
        'GET /api/assets': (req) =>
          new URL(req.url).searchParams.get('cursor')
            ? json(200, { items: second, next_cursor: null })
            : json(200, { items: first, next_cursor: 'c1' }),
      },
    })

    const prev = await screen.findByRole('button', { name: ko.viewer.prev })
    expect(screen.getByRole('button', { name: ko.viewer.next })).toBeVisible()
    await user.click(prev)
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/photos/z1')
    })
  })

  it('family_sees_no_edit_controls', async () => {
    renderViewer({ path: '/photos/a', ids: ['a'], role: 'family' })
    const info = await openInfo()

    expect(
      within(info).getByRole('link', { name: ko.viewer.download }),
    ).toHaveAttribute('href', '/api/assets/a/original')
    expect(
      within(info).getByRole('link', { name: ko.viewer.download }),
    ).toHaveAttribute('download', 'IMG_0001.JPG')
    expect(
      within(info).queryByRole('button', { name: ko.viewer.editCaption }),
    ).toBeNull()
    expect(
      within(info).queryByRole('button', { name: ko.viewer.editTakenAt }),
    ).toBeNull()
    expect(
      within(info).queryByRole('button', { name: ko.viewer.editBabies }),
    ).toBeNull()
    expect(
      within(info).queryByRole('button', { name: ko.viewer.trash }),
    ).toBeNull()
    expect(
      within(info).queryByRole('button', { name: ko.viewer.setAvatar }),
    ).toBeNull()
  })

  it('shows_taken_at_in_instance_zone_with_source', async () => {
    renderViewer({
      path: '/photos/a',
      ids: ['a'],
      assets: {
        a: assetFixture('a', {
          taken_at: '2024-05-01T16:30:00Z',
          taken_at_source: 'file_mtime',
          camera_make: 'Apple',
          camera_model: 'iPhone 15 Pro',
        }),
      },
    })
    const info = await openInfo()

    expect(await within(info).findByText(/2024년 5월 2일/)).toBeInTheDocument()
    expect(
      within(info).getByText(
        `${ko.viewer.sourceLabel}: ${ko.viewer.source.file_mtime}`,
      ),
    ).toBeInTheDocument()
    expect(within(info).getByText('Apple iPhone 15 Pro')).toBeInTheDocument()
  })

  it('trash_then_undo', async () => {
    const calls: string[] = []
    const { router, user } = renderViewer({
      path: '/photos/a',
      ids: ['a', 'b'],
      extra: {
        'DELETE /api/assets/a': () => {
          calls.push('delete')
          return json(204, null)
        },
        'POST /api/assets/a/restore': () => {
          calls.push('restore')
          return json(200, assetFixture('a'))
        },
      },
    })
    const info = await openInfo()

    await user.click(
      within(info).getByRole('button', { name: ko.viewer.trash }),
    )
    const confirm = await screen.findByRole('dialog', {
      name: ko.viewer.trashTitle,
    })
    await user.click(
      within(confirm).getByRole('button', { name: ko.viewer.trash }),
    )

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/photos/b')
    })
    expect(await screen.findByText(ko.viewer.trashed)).toBeInTheDocument()
    // sonner 의 pointerdown 이 jsdom 미구현 setPointerCapture 호출. click 만 발생.
    fireEvent.click(screen.getByRole('button', { name: ko.viewer.undo }))

    await waitFor(() => {
      expect(calls).toEqual(['delete', 'restore'])
    })
    expect(await screen.findByText(ko.viewer.restored)).toBeInTheDocument()
  })

  it('caption_edit_sends_patch', async () => {
    let body: unknown
    const { user } = renderViewer({
      path: '/photos/a',
      ids: ['a'],
      extra: {
        'PATCH /api/assets/a': async (req) => {
          body = await req.json()
          return json(200, assetFixture('a', { caption: '첫 걸음' }))
        },
      },
    })
    const info = await openInfo()

    await user.click(
      within(info).getByRole('button', { name: ko.viewer.editCaption }),
    )
    await user.type(
      within(info).getByRole('textbox', { name: ko.viewer.caption }),
      '  첫 걸음  ',
    )
    await user.click(within(info).getByRole('button', { name: ko.common.save }))

    await waitFor(() => {
      expect(body).toEqual({ caption: '  첫 걸음  ' })
    })
    expect(await within(info).findByText('첫 걸음')).toBeInTheDocument()
  })

  it('taken_at_edit_sends_utc', async () => {
    let body: unknown
    const { user } = renderViewer({
      path: '/photos/a',
      ids: ['a'],
      assets: { a: assetFixture('a', { taken_at: '2024-05-10T03:00:00Z' }) },
      extra: {
        'PATCH /api/assets/a': async (req) => {
          body = await req.json()
          return json(200, assetFixture('a'))
        },
      },
    })
    const info = await openInfo()

    await user.click(
      await within(info).findByRole('button', { name: ko.viewer.editTakenAt }),
    )
    const input = within(info).getByLabelText(ko.viewer.takenAt)
    expect(input).toHaveValue('2024-05-10T12:00')
    expect(
      within(info).getByText(`${ko.viewer.timezone}: Asia/Seoul`),
    ).toBeInTheDocument()
    fireEvent.change(input, { target: { value: '2024-05-09T08:30' } })
    await user.click(within(info).getByRole('button', { name: ko.common.save }))

    await waitFor(() => {
      expect(body).toEqual({ taken_at: '2024-05-08T23:30:00.000Z' })
    })
  })

  it('baby_tags_edit_puts_ids', async () => {
    const first = babyFixture()
    const second = babyFixture({
      id: '00000000-0000-4000-8000-0000000000b2',
      name: '바다',
      sort_order: 1,
    })
    let body: unknown
    const { user } = renderViewer({
      path: '/photos/a',
      ids: ['a'],
      babies: [first, second],
      assets: { a: assetFixture('a', { baby_ids: [second.id] }) },
      extra: {
        'PUT /api/assets/a/babies': async (req) => {
          body = await req.json()
          return json(
            200,
            assetFixture('a', { baby_ids: [first.id, second.id] }),
          )
        },
      },
    })
    const info = await openInfo()
    expect(await within(info).findByText('바다')).toBeInTheDocument()

    await user.click(
      within(info).getByRole('button', { name: ko.viewer.editBabies }),
    )
    expect(within(info).getByRole('checkbox', { name: '바다' })).toBeChecked()
    await user.click(within(info).getByRole('checkbox', { name: '하늘' }))
    await user.click(within(info).getByRole('button', { name: ko.common.save }))

    await waitFor(() => {
      expect(body).toEqual({ baby_ids: [first.id, second.id] })
    })
  })

  it('retry_failed', async () => {
    let state: Asset = assetFixture('a', {
      status: 'failed',
      derivatives: {},
      processing_error: 'decode error',
    })
    let retried = 0
    const { user } = renderViewer({
      path: '/photos/a',
      ids: ['a'],
      list: () => [
        assetSummaryFixture('a', { status: state.status, derivatives: {} }),
      ],
      extra: {
        'GET /api/assets/a': () => json(200, state),
        'POST /api/assets/a/retry': () => {
          retried += 1
          state = { ...state, status: 'processing', processing_error: null }
          return json(202, state)
        },
      },
    })

    expect(await screen.findByText(ko.viewer.failed)).toBeInTheDocument()
    expect(screen.getByText('decode error')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: ko.viewer.retry }))

    expect(await screen.findByText(ko.timeline.processing)).toBeInTheDocument()
    expect(retried).toBe(1)
    expect(screen.queryByText(ko.viewer.failed)).not.toBeInTheDocument()
  })

  it('family_sees_no_retry', async () => {
    renderViewer({
      path: '/photos/a',
      ids: ['a'],
      role: 'family',
      assets: {
        a: assetFixture('a', {
          status: 'failed',
          derivatives: {},
          processing_error: 'decode error',
        }),
      },
    })

    expect(await screen.findByText(ko.viewer.failed)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: ko.viewer.retry }),
    ).not.toBeInTheDocument()
  })

  it('set_avatar_keeps_other_fields', async () => {
    const baby = babyFixture({
      name: '하늘',
      birth_date: '2024-01-31',
      sex: 'female',
      avatar_asset_id: null,
    })
    let body: unknown
    const { user } = renderViewer({
      path: '/photos/a',
      ids: ['a'],
      babies: [baby],
      extra: {
        [`PUT /api/babies/${baby.id}`]: async (req) => {
          body = await req.json()
          return json(200, { ...baby, avatar_asset_id: 'a' })
        },
      },
    })
    const info = await openInfo()

    await user.click(
      await within(info).findByRole('button', { name: ko.viewer.setAvatar }),
    )
    const pick = await screen.findByRole('dialog', {
      name: ko.viewer.setAvatarTitle,
    })
    await user.click(within(pick).getByRole('button', { name: '하늘' }))

    await waitFor(() => {
      expect(body).toEqual({
        name: '하늘',
        birth_date: '2024-01-31',
        sex: 'female',
        avatar_asset_id: 'a',
        avatar_crop: null,
      })
    })
  })

  it('close_restores_timeline_scroll', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo')
    const { router, user } = renderViewer({ path: '/' })
    const tiles = await screen.findAllByRole('link', {
      name: '사진, 5월 10일 금요일, 12:00',
    })

    // 타임라인을 800px 스크롤한 상태. 라우터는 scroll 이벤트가 난 대상만 저장.
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(800)
    fireEvent.scroll(document)
    const tile = tiles[1]
    if (!tile) throw new Error('타일 없음')
    await user.click(tile)
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/photos/b')
    })
    await screen.findByRole('button', { name: ko.viewer.info })
    scrollTo.mockClear()

    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/')
    })
    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith(
        expect.objectContaining({ top: 800 }),
      )
    })
    expect(scrollTo).not.toHaveBeenCalledWith(
      expect.objectContaining({ top: 0 }),
    )
  })

  it('nav_buttons_on_narrow_video', async () => {
    // jsdom 은 CSS 미적용. 360px 에서도 버튼이 렌더되는지(존재·라벨)만 확인.
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(360)
    const video = { kind: 'video' as const, duration_ms: 65_000 }
    const { router, user } = renderViewer({
      path: '/photos/b',
      list: () => ['a', 'b', 'c'].map((id) => assetSummaryFixture(id, video)),
      assets: { b: assetFixture('b', video) },
    })
    await waitFor(() => {
      expect(document.querySelector('video')).not.toBeNull()
    })

    expect(
      await screen.findByRole('button', { name: ko.viewer.prev }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: ko.viewer.next }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/photos/c')
    })
  })

  it('caption_edit_keeps_list_taken_at_edit_refetches', async () => {
    let listCalls = 0
    const { user } = renderViewer({
      path: '/photos/a',
      ids: ['a'],
      extra: {
        'GET /api/assets': () => {
          listCalls += 1
          return json(200, {
            items: [assetSummaryFixture('a')],
            next_cursor: null,
          })
        },
        'PATCH /api/assets/a': async (req) => {
          const body = (await req.json()) as { caption?: string }
          return json(200, assetFixture('a', { caption: body.caption ?? null }))
        },
      },
    })
    const info = await openInfo()
    await waitFor(() => {
      expect(listCalls).toBe(1)
    })

    // 캡션: 목록 항목에 없는 필드라 목록 재조회 없음.
    await user.click(
      within(info).getByRole('button', { name: ko.viewer.editCaption }),
    )
    await user.type(
      within(info).getByRole('textbox', { name: ko.viewer.caption }),
      '첫 걸음',
    )
    await user.click(within(info).getByRole('button', { name: ko.common.save }))
    expect(await within(info).findByText('첫 걸음')).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 50))
    expect(listCalls).toBe(1)

    // 촬영 시각: 날짜 그룹이 바뀔 수 있어 목록 재조회.
    await user.click(
      within(info).getByRole('button', { name: ko.viewer.editTakenAt }),
    )
    fireEvent.change(within(info).getByLabelText(ko.viewer.takenAt), {
      target: { value: '2024-05-09T08:30' },
    })
    await user.click(within(info).getByRole('button', { name: ko.common.save }))
    await waitFor(() => {
      expect(listCalls).toBe(2)
    })
  })

  it('escape_closes_to_timeline_on_direct_entry', async () => {
    const { router, user } = renderViewer({ path: '/photos/b?baby=x' })
    await screen.findByRole('button', { name: ko.viewer.info })

    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/')
    })
    expect(router.state.location.search).toEqual({ baby: 'x' })
  })
})
