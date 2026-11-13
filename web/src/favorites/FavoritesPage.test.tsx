import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssetPage } from '@/api/types'
import { initI18n } from '@/i18n'
import ko from '@/locales/ko.json'
import { json, mockFetch } from '@/test/fetch'
import {
  assetFixture,
  assetSummaryFixture,
  emptyFeedRoutes,
  settingsFixture,
  userFixture,
} from '@/test/fixtures'
import { intersectAll } from '@/test/intersection'
import { renderApp } from '@/test/router'

beforeEach(() => {
  initI18n('ko')
  // jsdom 은 canvas 미구현. 뷰어 blurhash 경고 방지.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => null,
  )
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderFavorites(
  page: (url: URL) => AssetPage,
  extra: Parameters<typeof mockFetch>[0] = {},
) {
  const requests: URL[] = []
  mockFetch({
    'GET /api/auth/me': () => json(200, { user: userFixture('family') }),
    'GET /api/settings': () => json(200, settingsFixture),
    'GET /api/favorites': (req) => {
      const url = new URL(req.url)
      requests.push(url)
      return json(200, page(url))
    },
    ...emptyFeedRoutes,
    ...extra,
  })
  return { ...renderApp('/albums/favorites'), requests }
}

describe('FavoritesPage', () => {
  it('lists_favorites_grid', async () => {
    const { requests, user, router } = renderFavorites((url) =>
      url.searchParams.get('cursor') === 'c1'
        ? { items: [assetSummaryFixture('c')], next_cursor: null }
        : {
            items: [assetSummaryFixture('a'), assetSummaryFixture('b')],
            next_cursor: 'c1',
          },
    )
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: ko.albums.favorites,
      }),
    ).toBeVisible()
    const main = within(await screen.findByRole('main'))
    expect(await main.findAllByRole('link', { name: /^사진,/ })).toHaveLength(2)

    // 끝에 닿으면 다음 페이지.
    intersectAll()
    await waitFor(() => {
      expect(main.getAllByRole('link', { name: /^사진,/ })).toHaveLength(3)
    })
    expect(requests.map((u) => u.searchParams.get('cursor'))).toEqual([
      null,
      'c1',
    ])

    await user.click(screen.getByRole('button', { name: ko.me.back }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/albums')
    })
  })

  it('empty_message', async () => {
    renderFavorites(() => ({ items: [], next_cursor: null }))
    expect(await screen.findByText(ko.favorites.empty)).toBeVisible()
    expect(screen.queryByRole('link', { name: /^사진,/ })).toBeNull()
  })

  it('tile_opens_viewer_from_favorites', async () => {
    const { user, router } = renderFavorites(
      () => ({ items: [assetSummaryFixture('a')], next_cursor: null }),
      { 'GET /api/assets/a': () => json(200, assetFixture('a')) },
    )
    const tile = await within(await screen.findByRole('main')).findByRole(
      'link',
      { name: /^사진,/ },
    )
    expect(tile).toHaveAttribute('href', '/photos/a?from=favorites')
    await user.click(tile)
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/photos/a')
    })
    expect(router.state.location.search).toEqual({ from: 'favorites' })
  })
})
