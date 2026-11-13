import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AlbumSummary, Baby, Role } from '@/api/types'
import { initI18n } from '@/i18n'
import ko from '@/locales/ko.json'
import { json, mockFetch } from '@/test/fetch'
import {
  albumFixture,
  apiError,
  assetSummaryFixture,
  babyFixture,
  emptyFeedRoutes,
  settingsFixture,
  userFixture,
} from '@/test/fixtures'
import { renderApp } from '@/test/router'

beforeEach(() => {
  initI18n('ko')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const SKY = babyFixture()
const SEA = babyFixture({
  id: '00000000-0000-4000-8000-0000000000b2',
  name: '바다',
  sort_order: 1,
})

function renderAlbums(
  babies: Baby[],
  role: Role = 'family',
  albums: AlbumSummary[] = [],
  extra: Parameters<typeof mockFetch>[0] = {},
) {
  mockFetch({
    ...emptyFeedRoutes,
    'GET /api/auth/me': () => json(200, { user: userFixture(role) }),
    'GET /api/settings': () => json(200, settingsFixture),
    'GET /api/babies': () => json(200, babies),
    'GET /api/assets': () => json(200, { items: [], next_cursor: null }),
    'GET /api/albums': () => json(200, albums),
    ...extra,
  })
  return renderApp('/albums')
}

const TRIP = albumFixture('00000000-0000-4000-8000-0000000000a1', {
  name: '첫 제주 여행',
  cover: assetSummaryFixture('c1'),
  photo_count: 40,
  video_count: 8,
})
const BATH = albumFixture('00000000-0000-4000-8000-0000000000a2', {
  name: '목욕 시간',
  photo_count: 1,
})

describe('AlbumsPage', () => {
  it('fixed_tiles', async () => {
    const { user, router } = renderAlbums([SKY, SEA])
    expect(
      await screen.findByRole('heading', { level: 1, name: ko.albums.title }),
    ).toBeVisible()
    const tiles = within(
      await screen.findByRole('list', { name: ko.albums.fixed }),
    )
    await waitFor(() => {
      expect(tiles.getAllByRole('link')).toHaveLength(4)
    })
    const links = tiles.getAllByRole('link')
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/albums/favorites',
      '/albums/videos',
      `/babies/${SKY.id}`,
      `/babies/${SEA.id}`,
    ])
    expect(links[0]).toHaveAccessibleName(ko.albums.favorites)
    expect(links[1]).toHaveAccessibleName(ko.albums.videos)
    expect(links[2]).toHaveAccessibleName(`${SKY.name} ${ko.albums.monthly}`)
    expect(links[3]).toHaveAccessibleName(`${SEA.name} ${ko.albums.monthly}`)

    await user.click(tiles.getByRole('link', { name: ko.albums.videos }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/albums/videos')
    })
  })

  // 아기 없으면 즐겨찾기, 영상만.
  it('fixed_tiles_without_babies', async () => {
    renderAlbums([], 'owner')
    const tiles = within(
      await screen.findByRole('list', { name: ko.albums.fixed }),
    )
    expect(tiles.getAllByRole('link')).toHaveLength(2)
  })

  // 서버 응답 순서 그대로. 이름, 사진+영상 수, 표지.
  it('albums_grid', async () => {
    renderAlbums([SKY], 'family', [TRIP, BATH])
    expect(
      await screen.findByRole('heading', { level: 2, name: ko.albums.ours }),
    ).toBeVisible()
    const grid = within(screen.getByRole('list', { name: ko.albums.ours }))
    const links = grid.getAllByRole('link')
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      `/albums/${TRIP.id}`,
      `/albums/${BATH.id}`,
    ])
    expect(links[0]).toHaveAccessibleName('첫 제주 여행, 48개')
    expect(links[1]).toHaveAccessibleName('목욕 시간, 1개')
    expect(links[0]?.querySelector('img')).toHaveAttribute(
      'src',
      '/api/assets/c1/thumb.webp',
    )
  })

  // 표지 없음(사진이 전부 처리 중, 실패, 빈 앨범): 옅은 면 + 아이콘. 깨진 이미지 없음.
  it('album_tile_without_cover', async () => {
    renderAlbums([], 'family', [BATH])
    const link = await screen.findByRole('link', { name: '목욕 시간, 1개' })
    expect(link.querySelector('img')).toBeNull()
    expect(link.querySelector('svg')).not.toBeNull()
  })

  it('new_album_guardian_only', async () => {
    renderAlbums([], 'family', [TRIP])
    await screen.findByRole('link', { name: '첫 제주 여행, 48개' })
    expect(screen.queryByRole('button', { name: ko.albums.new })).toBeNull()
    cleanup()

    // family 앨범 없음: 우리 앨범 영역 숨김.
    renderAlbums([], 'family', [])
    await screen.findByRole('list', { name: ko.albums.fixed })
    await waitFor(() => {
      expect(screen.queryByText(ko.albums.ours)).toBeNull()
    })
    expect(screen.queryByRole('button', { name: ko.albums.new })).toBeNull()
    cleanup()

    // guardian 앨범 없음: 머리글 버튼 + 새 앨범 칸 하나.
    renderAlbums([], 'guardian', [])
    const grid = within(
      await screen.findByRole('list', { name: ko.albums.ours }),
    )
    expect(grid.getAllByRole('listitem')).toHaveLength(1)
    expect(
      grid.getByRole('button', { name: ko.albums.new }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: ko.albums.new })).toHaveLength(
      2,
    )
  })

  it('albums_load_error_retry', async () => {
    let fail = true
    const { user } = renderAlbums([], 'family', [], {
      'GET /api/albums': () =>
        fail ? apiError(500, 'server.internal') : json(200, [TRIP]),
    })
    expect(
      await screen.findByText(ko.errors.server.internal),
    ).toBeInTheDocument()
    fail = false
    await user.click(screen.getByRole('button', { name: ko.common.retry }))
    expect(
      await screen.findByRole('link', { name: '첫 제주 여행, 48개' }),
    ).toBeInTheDocument()
  })

  // 이름 대화상자 → POST(asset_ids 키 없음) → 새 앨범 화면.
  it('create_navigates', async () => {
    const created = albumFixture('00000000-0000-4000-8000-0000000000a3', {
      name: '여름',
    })
    const bodies: unknown[] = []
    const { user, router } = renderAlbums([], 'guardian', [TRIP], {
      'POST /api/albums': async (req) => {
        bodies.push(await req.json())
        return json(201, created)
      },
      [`GET /api/albums/${created.id}`]: () => json(200, created),
      [`GET /api/albums/${created.id}/assets`]: () =>
        json(200, { items: [], next_cursor: null }),
    })
    await screen.findByRole('link', { name: '첫 제주 여행, 48개' })
    const [headerNew] = screen.getAllByRole('button', { name: ko.albums.new })
    if (!headerNew) throw new Error('새 앨범 버튼 없음')
    await user.click(headerNew)
    const dialog = await screen.findByRole('dialog', { name: ko.albums.new })
    const submit = within(dialog).getByRole('button', {
      name: ko.albums.create,
    })
    // 공백만이면 만들 수 없음.
    await user.type(within(dialog).getByLabelText(ko.albums.nameLabel), '  ')
    expect(submit).toBeDisabled()
    await user.type(within(dialog).getByLabelText(ko.albums.nameLabel), '여름')
    await user.click(submit)
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/albums/${created.id}`)
    })
    expect(bodies).toEqual([{ name: '  여름' }])
    expect(
      await screen.findByRole('heading', { level: 1, name: '여름' }),
    ).toBeVisible()
  })

  // 댓글 입력과 같은 브라우저 온라인 기준.
  it('new_album_offline_disabled', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    renderAlbums([], 'guardian', [])
    await screen.findByRole('list', { name: ko.albums.ours })
    const buttons = screen.getAllByRole('button', { name: ko.albums.new })
    expect(buttons).toHaveLength(2)
    for (const b of buttons) expect(b).toBeDisabled()
  })
})
