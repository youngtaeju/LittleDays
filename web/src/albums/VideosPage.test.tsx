import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssetPage } from '@/api/types'
import { initI18n } from '@/i18n'
import ko from '@/locales/ko.json'
import { json, mockFetch } from '@/test/fetch'
import {
  assetSummaryFixture,
  emptyFeedRoutes,
  settingsFixture,
  userFixture,
} from '@/test/fixtures'
import { intersectAll } from '@/test/intersection'
import { renderApp } from '@/test/router'

beforeEach(() => {
  initI18n('ko')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function video(id: string) {
  return assetSummaryFixture(id, { kind: 'video', duration_ms: 5000 })
}

function renderVideos(page: (url: URL) => AssetPage) {
  const requests: URL[] = []
  mockFetch({
    ...emptyFeedRoutes,
    'GET /api/auth/me': () => json(200, { user: userFixture('family') }),
    'GET /api/albums': () => json(200, []),
    'GET /api/settings': () => json(200, settingsFixture),
    'GET /api/assets': (req) => {
      const url = new URL(req.url)
      requests.push(url)
      return json(200, page(url))
    },
  })
  return { ...renderApp('/albums/videos'), requests }
}

describe('VideosPage', () => {
  it('videos_only', async () => {
    const { requests, user, router } = renderVideos((url) =>
      url.searchParams.get('cursor') === 'c1'
        ? { items: [video('c')], next_cursor: null }
        : { items: [video('a'), video('b')], next_cursor: 'c1' },
    )
    expect(
      await screen.findByRole('heading', { level: 1, name: ko.albums.videos }),
    ).toBeVisible()
    const main = within(screen.getByRole('main'))
    const tiles = await main.findAllByRole('link', { name: /^영상,/ })
    expect(tiles).toHaveLength(2)
    expect(tiles[0]).toHaveAttribute('href', '/photos/a?from=videos')

    intersectAll()
    await waitFor(() => {
      expect(main.getAllByRole('link', { name: /^영상,/ })).toHaveLength(3)
    })
    expect(requests.map((u) => u.searchParams.get('kind'))).toEqual([
      'video',
      'video',
    ])
    expect(requests.map((u) => u.searchParams.get('cursor'))).toEqual([
      null,
      'c1',
    ])
    expect(requests[0]?.searchParams.get('baby_id')).toBeNull()

    // 직접 진입이면 뒤로 = 앨범 탭.
    await user.click(screen.getByRole('button', { name: ko.me.back }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/albums')
    })
    // 도착 라우트 로드/전환 종료까지 대기. 환경 해제 후 setState 방지.
    expect(
      await screen.findByRole('heading', { level: 1, name: ko.albums.title }),
    ).toBeVisible()
    await waitFor(() => {
      expect(router.state.status).toBe('idle')
    })
  })

  it('empty_message', async () => {
    renderVideos(() => ({ items: [], next_cursor: null }))
    expect(await screen.findByText(ko.albums.videosEmpty)).toBeVisible()
  })
})
