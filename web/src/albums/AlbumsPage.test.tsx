import { cleanup, screen, waitFor, within } from '@testing-library/react'
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

function renderAlbums(babies: Baby[], role: Role = 'family') {
  mockFetch({
    ...emptyFeedRoutes,
    'GET /api/auth/me': () => json(200, { user: userFixture(role) }),
    'GET /api/settings': () => json(200, settingsFixture),
    'GET /api/babies': () => json(200, babies),
    'GET /api/assets': () => json(200, { items: [], next_cursor: null }),
  })
  return renderApp('/albums')
}

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
})
