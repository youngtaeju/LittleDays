import { onlineManager } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from 'vitest'
import type { AlbumSummary, AssetPage, Role } from '@/api/types'
import { initI18n } from '@/i18n'
import ko from '@/locales/ko.json'
import { json, mockFetch } from '@/test/fetch'
import {
  albumFixture,
  apiError,
  assetFixture,
  assetSummaryFixture,
  babyFixture,
  emptyFeedRoutes,
  settingsFixture,
  userFixture,
} from '@/test/fixtures'
import { renderApp } from '@/test/router'
import { assetKey } from '@/timeline/useTimeline'
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

const ID = '00000000-0000-4000-8000-0000000000a1'
const B1 = babyFixture()

function photo(id: string) {
  return assetSummaryFixture(id)
}

function setup({
  role = 'guardian',
  album = albumFixture(ID, { photo_count: 3 }),
  page = { items: [photo('a'), photo('b'), photo('c')], next_cursor: null },
  extra = {},
}: {
  role?: Role
  album?: AlbumSummary
  page?: AssetPage
  extra?: Parameters<typeof mockFetch>[0]
} = {}) {
  const counts = { album: 0, list: 0 }
  mockFetch({
    ...emptyFeedRoutes,
    'GET /api/auth/me': () => json(200, { user: userFixture(role) }),
    'GET /api/settings': () => json(200, settingsFixture),
    'GET /api/babies': () => json(200, [B1]),
    'GET /api/albums': () => json(200, []),
    [`GET /api/albums/${ID}`]: () => {
      counts.album += 1
      return json(200, album)
    },
    [`GET /api/albums/${ID}/assets`]: () => {
      counts.list += 1
      return json(200, page)
    },
    ...extra,
  })
  return { ...renderApp(`/albums/${ID}`), counts }
}

function grid() {
  return within(screen.getByRole('list', { name: ko.albums.photoGrid }))
}

function fileInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[type=file]')
  if (!input) throw new Error('파일 입력 없음')
  return input
}

function jpg(name = 'a.jpg') {
  return new File(['x'], name, { type: 'image/jpeg', lastModified: 1 })
}

describe('AlbumPage', () => {
  // 사진, 영상, 기간. 0 항목 생략, 같은 해면 끝 연도 생략.
  it('meta_line', async () => {
    setup({
      album: albumFixture(ID, {
        photo_count: 44,
        video_count: 4,
        from: '2026-08-02',
        to: '2026-08-05',
      }),
    })
    expect(
      await screen.findByRole('heading', { level: 1, name: '첫 제주 여행' }),
    ).toBeVisible()
    expect(
      screen.getByText('사진 44 · 영상 4 · 2026년 8월 2일 ~ 8월 5일'),
    ).toBeVisible()
    cleanup()

    setup({
      album: albumFixture(ID, {
        video_count: 5,
        from: '2025-12-30',
        to: '2026-01-02',
      }),
    })
    expect(
      await screen.findByText('영상 5 · 2025년 12월 30일 ~ 2026년 1월 2일'),
    ).toBeVisible()
    cleanup()

    setup({
      album: albumFixture(ID, {
        photo_count: 3,
        from: '2026-08-02',
        to: '2026-08-02',
      }),
    })
    expect(await screen.findByText('사진 3 · 2026년 8월 2일')).toBeVisible()
  })

  it('guardian_buttons', async () => {
    setup({ role: 'family' })
    await screen.findByRole('heading', { level: 1, name: '첫 제주 여행' })
    const tiles = await waitFor(() => grid().getAllByRole('link'))
    expect(tiles).toHaveLength(3)
    // 뷰어 이전/다음 기준은 이 앨범.
    expect(tiles[0]).toHaveAttribute('href', `/photos/a?from=album&of=${ID}`)
    expect(
      screen.queryByRole('button', { name: ko.albums.addPhotos }),
    ).toBeNull()
    expect(screen.queryByRole('button', { name: ko.albums.select })).toBeNull()
    expect(screen.queryByRole('button', { name: ko.albums.menu })).toBeNull()
    cleanup()

    setup({ role: 'guardian' })
    expect(
      await screen.findByRole('button', { name: ko.albums.addPhotos }),
    ).toBeEnabled()
    expect(screen.getByRole('button', { name: ko.albums.select })).toBeEnabled()
    expect(screen.getByRole('button', { name: ko.albums.menu })).toBeEnabled()
  })

  // 이미 든 사진도 선택 없이 시작. 고른 것만 넣기.
  it('add_from_uploaded', async () => {
    const bodies: unknown[] = []
    const { user, counts, queryClient } = setup({
      extra: {
        'GET /api/assets': () =>
          json(200, {
            items: [photo('a'), photo('x'), photo('y')],
            next_cursor: null,
          }),
        [`POST /api/albums/${ID}/assets`]: async (req) => {
          bodies.push(await req.json())
          return json(204, null)
        },
      },
    })
    await user.click(
      await screen.findByRole('button', { name: ko.albums.addPhotos }),
    )
    await user.click(
      await screen.findByRole('button', { name: ko.albums.pickUploaded }),
    )
    const sheet = await screen.findByRole('dialog', {
      name: ko.stories.pickTitle,
    })
    const tiles = await within(sheet).findAllByRole('button', {
      name: /^사진,/,
    })
    expect(tiles).toHaveLength(3)
    for (const tile of tiles)
      expect(tile).toHaveAttribute('aria-pressed', 'false')
    const listBefore = counts.list
    queryClient.setQueryData(assetKey('y'), assetFixture('y'))
    const [, , y] = tiles
    if (!y) throw new Error('타일 없음')
    await user.click(y)
    await user.click(within(sheet).getByRole('button', { name: '1장 고르기' }))
    await waitFor(() => {
      expect(bodies).toEqual([{ asset_ids: ['y'] }])
    })
    expect(await screen.findByText('1개를 담았어요')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    // 사진 상세의 album_ids 도 낡음.
    expect(queryClient.getQueryState(assetKey('y'))?.isInvalidated).toBe(true)
    // 앨범 요약, 사진 목록 다시 받음.
    await waitFor(() => {
      expect(counts.list).toBeGreaterThan(listBefore)
    })
  })

  // 아무것도 안 고르고 끝내면 요청 없음.
  it('add_from_uploaded_none', async () => {
    const { user } = setup({
      extra: {
        'GET /api/assets': () =>
          json(200, { items: [photo('x')], next_cursor: null }),
      },
    })
    await user.click(
      await screen.findByRole('button', { name: ko.albums.addPhotos }),
    )
    await user.click(
      await screen.findByRole('button', { name: ko.albums.pickUploaded }),
    )
    const sheet = await screen.findByRole('dialog', {
      name: ko.stories.pickTitle,
    })
    await within(sheet).findAllByRole('button', { name: /^사진,/ })
    await user.click(within(sheet).getByRole('button', { name: '0장 고르기' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })

  // 새로 올리기: 확인 시트까지 앨범 대상 유지. 끌어다 놓기는 대상 없음.
  it('add_new_upload', async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click')
    const { user } = setup()
    await user.click(
      await screen.findByRole('button', { name: ko.albums.addPhotos }),
    )
    click.mockClear()
    await user.click(
      await screen.findByRole('button', { name: ko.albums.uploadNew }),
    )
    expect(click).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: ko.albums.addPhotos }),
      ).toBeNull()
    })

    const file = jpg()
    await user.upload(fileInput(), file)
    let dialog = await screen.findByRole('dialog', { name: '사진 1장 올리기' })
    await user.click(
      within(dialog).getByRole('button', { name: ko.upload.submit }),
    )
    await waitFor(() => {
      expect(add).toHaveBeenCalledWith([file], [B1.id], {
        kind: 'album',
        id: ID,
      })
    })

    const dropped = jpg('b.jpg')
    fireEvent.dragEnter(window, { dataTransfer: { types: ['Files'] } })
    fireEvent.drop(window, {
      dataTransfer: { types: ['Files'], files: [dropped] },
    })
    dialog = await screen.findByRole('dialog', { name: '사진 1장 올리기' })
    await user.click(
      within(dialog).getByRole('button', { name: ko.upload.submit }),
    )
    await waitFor(() => {
      expect(add).toHaveBeenLastCalledWith([dropped], [B1.id])
    })
  })

  it('select_remove', async () => {
    const bodies: unknown[] = []
    const { user, queryClient } = setup({
      extra: {
        [`POST /api/albums/${ID}/assets/remove`]: async (req) => {
          bodies.push(await req.json())
          return json(204, null)
        },
      },
    })
    await user.click(
      await screen.findByRole('button', { name: ko.albums.select }),
    )
    const remove0 = screen.getByRole('button', { name: '앨범에서 빼기 (0)' })
    expect(remove0).toBeDisabled()
    // 고르기 중에는 사진 추가 숨김.
    expect(
      screen.queryByRole('button', { name: ko.albums.addPhotos }),
    ).toBeNull()

    // 취소하면 선택 버리고 링크로.
    const [first] = grid().getAllByRole('button')
    if (!first) throw new Error('타일 없음')
    await user.click(first)
    await user.click(screen.getByRole('button', { name: ko.common.cancel }))
    expect(grid().getAllByRole('link')).toHaveLength(3)

    queryClient.setQueryData(assetKey('a'), assetFixture('a'))
    await user.click(screen.getByRole('button', { name: ko.albums.select }))
    const tiles = grid().getAllByRole('button')
    expect(tiles).toHaveLength(3)
    const [a, b, c] = tiles
    if (!a || !b || !c) throw new Error('타일 없음')
    expect(a).toHaveAttribute('aria-pressed', 'false')
    await user.click(a)
    await user.click(c)
    expect(a).toHaveAttribute('aria-pressed', 'true')
    expect(b).toHaveAttribute('aria-pressed', 'false')
    await user.click(screen.getByRole('button', { name: '앨범에서 빼기 (2)' }))
    await waitFor(() => {
      expect(bodies).toEqual([{ asset_ids: ['a', 'c'] }])
    })
    expect(await screen.findByText('2개를 뺐어요')).toBeInTheDocument()
    expect(queryClient.getQueryState(assetKey('a'))?.isInvalidated).toBe(true)
    // 고르기 모드 끝.
    expect(
      await screen.findByRole('button', { name: ko.albums.select }),
    ).toBeInTheDocument()
    expect(grid().getAllByRole('link')).toHaveLength(3)
  })

  it('rename_and_delete', async () => {
    let album = albumFixture(ID)
    let deleted = false
    let getsAfterDelete = 0
    const patches: unknown[] = []
    const { user, router, queryClient } = setup({
      extra: {
        [`GET /api/albums/${ID}`]: () => {
          if (deleted) {
            getsAfterDelete += 1
            return apiError(404, 'album.notFound')
          }
          return json(200, album)
        },
        [`PATCH /api/albums/${ID}`]: async (req) => {
          const body = (await req.json()) as { name: string }
          patches.push(body)
          album = { ...album, name: body.name }
          return json(200, album)
        },
        [`DELETE /api/albums/${ID}`]: () => {
          deleted = true
          return json(204, null)
        },
      },
    })
    await user.click(
      await screen.findByRole('button', { name: ko.albums.menu }),
    )
    await user.click(
      await screen.findByRole('menuitem', { name: ko.albums.rename }),
    )
    const renameDialog = await screen.findByRole('dialog', {
      name: ko.albums.rename,
    })
    const input = within(renameDialog).getByLabelText(ko.albums.nameLabel)
    expect(input).toHaveValue('첫 제주 여행')
    await user.clear(input)
    await user.type(input, '제주')
    await user.click(
      within(renameDialog).getByRole('button', { name: ko.common.save }),
    )
    expect(
      await screen.findByRole('heading', { level: 1, name: '제주' }),
    ).toBeVisible()
    expect(patches).toEqual([{ name: '제주' }])
    expect(screen.queryByRole('dialog')).toBeNull()

    queryClient.setQueryData(assetKey('a'), assetFixture('a'))
    await user.click(screen.getByRole('button', { name: ko.albums.menu }))
    await user.click(
      await screen.findByRole('menuitem', { name: ko.albums.delete }),
    )
    const deleteDialog = await screen.findByRole('dialog', {
      name: ko.albums.deleteTitle,
    })
    expect(
      within(deleteDialog).getByText(ko.albums.deleteDescription),
    ).toBeInTheDocument()
    await user.click(
      within(deleteDialog).getByRole('button', {
        name: ko.albums.deleteSubmit,
      }),
    )
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/albums')
    })
    expect(await screen.findByText(ko.albums.deleted)).toBeInTheDocument()
    expect(queryClient.getQueryState(assetKey('a'))?.isInvalidated).toBe(true)
    // 떠나기 전 다시 받으면 404 알림 깜박임.
    await new Promise((r) => setTimeout(r, 50))
    expect(getsAfterDelete).toBe(0)
    expect(screen.queryByText(ko.errors.album.notFound)).toBeNull()
  })

  it('rename_error_shown', async () => {
    const { user } = setup({
      extra: {
        [`PATCH /api/albums/${ID}`]: () => apiError(400, 'album.nameInvalid'),
      },
    })
    await user.click(
      await screen.findByRole('button', { name: ko.albums.menu }),
    )
    await user.click(
      await screen.findByRole('menuitem', { name: ko.albums.rename }),
    )
    const dialog = await screen.findByRole('dialog', { name: ko.albums.rename })
    await user.type(within(dialog).getByLabelText(ko.albums.nameLabel), '!')
    await user.click(
      within(dialog).getByRole('button', { name: ko.common.save }),
    )
    expect(
      await within(dialog).findByText(ko.errors.album.nameInvalid),
    ).toBeInTheDocument()
  })

  // 지워진 앨범: 앨범 탭으로 교체 이동 + 알림.
  it('missing_album', async () => {
    const { router } = setup({
      extra: {
        [`GET /api/albums/${ID}`]: () => apiError(404, 'album.notFound'),
        [`GET /api/albums/${ID}/assets`]: () => apiError(404, 'album.notFound'),
      },
    })
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/albums')
    })
    expect(router.history.length).toBe(1)
    expect(
      await screen.findByText(ko.errors.album.notFound),
    ).toBeInTheDocument()
  })

  it('empty_album', async () => {
    const empty = { items: [], next_cursor: null }
    setup({ role: 'guardian', album: albumFixture(ID), page: empty })
    expect(await screen.findByText(ko.albums.empty)).toBeVisible()
    // 뺄 사진이 없으니 고르기 없음.
    expect(
      screen.getByRole('button', { name: ko.albums.addPhotos }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: ko.albums.select })).toBeNull()
    cleanup()
    setup({ role: 'family', album: albumFixture(ID), page: empty })
    expect(await screen.findByText(ko.albums.emptyFamily)).toBeVisible()
  })

  // 댓글 입력과 같은 브라우저 온라인 기준.
  it('offline_disables_writes', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    setup()
    expect(
      await screen.findByRole('button', { name: ko.albums.addPhotos }),
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: ko.albums.select }),
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: ko.albums.menu })).toBeDisabled()
  })

  // 열어 둔 시트, 대화상자 안의 쓰기도 오프라인이면 막음.
  it('offline_inside_sheets', async () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    // offline 이벤트는 TanStack onlineManager 도 끔. 끝나면 되돌려 다음 테스트 조회 유지.
    const goOffline = (offline: boolean) => {
      onLine.mockReturnValue(!offline)
      fireEvent(window, new Event(offline ? 'offline' : 'online'))
    }
    onTestFinished(() => {
      onlineManager.setOnline(true)
    })
    const { user } = setup({
      extra: {
        'GET /api/assets': () =>
          json(200, { items: [photo('x')], next_cursor: null }),
      },
    })
    await user.click(
      await screen.findByRole('button', { name: ko.albums.addPhotos }),
    )
    const sheet = await screen.findByRole('dialog', {
      name: ko.albums.addPhotos,
    })
    goOffline(true)
    expect(
      within(sheet).getByRole('button', { name: ko.albums.pickUploaded }),
    ).toBeDisabled()
    expect(
      within(sheet).getByRole('button', { name: ko.albums.uploadNew }),
    ).toBeDisabled()

    goOffline(false)
    await user.click(
      within(sheet).getByRole('button', { name: ko.albums.pickUploaded }),
    )
    const picker = await screen.findByRole('dialog', {
      name: ko.stories.pickTitle,
    })
    await within(picker).findAllByRole('button', { name: /^사진,/ })
    goOffline(true)
    // 등록 안 된 POST 가 나가면 테스트 실패.
    expect(
      within(picker).getByRole('button', { name: '0장 고르기' }),
    ).toBeDisabled()
    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    goOffline(false)
    await user.click(screen.getByRole('button', { name: ko.albums.menu }))
    await user.click(
      await screen.findByRole('menuitem', { name: ko.albums.rename }),
    )
    const rename = await screen.findByRole('dialog', {
      name: ko.albums.rename,
    })
    const save = within(rename).getByRole('button', { name: ko.common.save })
    expect(save).toBeEnabled()
    goOffline(true)
    expect(save).toBeDisabled()
  })

  // 고르기 모드에 들어가면 취소로, 나오면 고르기 버튼으로 포커스.
  it('select_mode_focus', async () => {
    const { user } = setup({
      extra: {
        [`POST /api/albums/${ID}/assets/remove`]: () => json(204, null),
      },
    })
    await user.click(
      await screen.findByRole('button', { name: ko.albums.select }),
    )
    expect(screen.getByRole('button', { name: ko.common.cancel })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: ko.common.cancel }))
    expect(screen.getByRole('button', { name: ko.albums.select })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: ko.albums.select }))
    const [first] = grid().getAllByRole('button')
    if (!first) throw new Error('타일 없음')
    await user.click(first)
    await user.click(screen.getByRole('button', { name: '앨범에서 빼기 (1)' }))
    expect(
      await screen.findByRole('button', { name: ko.albums.select }),
    ).toHaveFocus()
  })

  // 지운 앨범은 목록 재조회 전에도 앨범 탭에 보이지 않음.
  it('delete_drops_from_album_list', async () => {
    const other = albumFixture('00000000-0000-4000-8000-0000000000a2', {
      name: '목욕 시간',
    })
    let deleted = false
    const { user, router, queryClient } = setup({
      extra: {
        // 지운 뒤 목록 재조회는 끝나지 않음(캐시만 보이게).
        'GET /api/albums': () =>
          deleted ? new Promise<Response>(() => undefined) : json(200, []),
        [`GET /api/albums/${ID}`]: () =>
          deleted
            ? apiError(404, 'album.notFound')
            : json(200, albumFixture(ID)),
        [`DELETE /api/albums/${ID}`]: () => {
          deleted = true
          return json(204, null)
        },
      },
    })
    queryClient.setQueryData(['assets', 'albums'], [albumFixture(ID), other])
    await user.click(
      await screen.findByRole('button', { name: ko.albums.menu }),
    )
    await user.click(
      await screen.findByRole('menuitem', { name: ko.albums.delete }),
    )
    const dialog = await screen.findByRole('dialog', {
      name: ko.albums.deleteTitle,
    })
    await user.click(
      within(dialog).getByRole('button', { name: ko.albums.deleteSubmit }),
    )
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/albums')
    })
    const ours = await screen.findByRole('list', { name: ko.albums.ours })
    expect(
      within(ours).getByRole('link', { name: /^목욕 시간,/ }),
    ).toBeInTheDocument()
    expect(
      within(ours).queryByRole('link', { name: /^첫 제주 여행,/ }),
    ).toBeNull()
  })
})
