import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssetPage, DayDetail } from '@/api/types'
import { initI18n } from '@/i18n'
import ko from '@/locales/ko.json'
import { json, mockFetch } from '@/test/fetch'
import {
  apiError,
  assetSummaryFixture,
  babyFixture,
  milestoneFixture,
  settingsFixture,
  storyFixture,
  userFixture,
} from '@/test/fixtures'
import { intersectAll } from '@/test/intersection'
import { renderApp } from '@/test/router'

beforeEach(() => {
  initI18n('ko')
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => null,
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const SKY = babyFixture({ birth_date: '2024-01-31' })

function detail(over: Partial<DayDetail> = {}): DayDetail {
  return {
    date: '2024-05-09',
    photo_count: 7,
    video_count: 1,
    uploader_ids: [userFixture('guardian').id],
    baby_ids: [SKY.id],
    like_count: 0,
    comment_count: 0,
    prev_date: '2024-05-07',
    next_date: '2024-05-10',
    stories: [],
    milestones: [],
    ...over,
  }
}

function items(n: number, from = 0): AssetPage['items'] {
  return Array.from({ length: n }, (_, i) =>
    assetSummaryFixture(`a${String(from + i)}`, { local_date: '2024-05-09' }),
  )
}

function renderDay(opts: {
  path?: string
  day?: () => Response
  assets?: (url: URL) => AssetPage
}) {
  const assetRequests: URL[] = []
  const dayRequests: URL[] = []
  mockFetch({
    'GET /api/auth/me': () => json(200, { user: userFixture('guardian') }),
    'GET /api/settings': () => json(200, settingsFixture),
    'GET /api/babies': () => json(200, [SKY]),
    'GET /api/users': () => json(200, { users: [userFixture('guardian')] }),
    'GET /api/days/2024-05-10': () => json(200, detail({ date: '2024-05-10' })),
    'GET /api/days/2024-05-09': (req) => {
      dayRequests.push(new URL(req.url))
      return opts.day?.() ?? json(200, detail())
    },
    'GET /api/assets': (req) => {
      const url = new URL(req.url)
      assetRequests.push(url)
      return json(
        200,
        opts.assets?.(url) ?? { items: items(8), next_cursor: null },
      )
    },
    'GET /api/days': () => json(200, { items: [], next_cursor: null }),
  })
  return {
    ...renderApp(opts.path ?? '/days/2024-05-09'),
    assetRequests,
    dayRequests,
  }
}

describe('DayPage', () => {
  it('day_grid_columns', async () => {
    const { assetRequests } = renderDay({})

    expect(
      await screen.findByRole('heading', { name: '2024년 5월 9일 목요일' }),
    ).toBeInTheDocument()
    // 나이(100일 배지) · 개수.
    const header = within(screen.getByRole('banner'))
    expect(await header.findByText('100일')).toBeInTheDocument()
    expect(header.getByText(/사진 7장 · 영상 1개/)).toBeInTheDocument()

    const tiles = await screen.findAllByRole('link', { name: /^사진,/ })
    expect(tiles).toHaveLength(8)
    const grid = tiles[0]?.closest('ul')
    expect(grid?.className).toContain('grid-cols-3')
    expect(grid?.className).toContain('sm:grid-cols-4')
    expect(grid?.className).toContain('lg:grid-cols-6')
    expect(grid?.className).toContain('gap-[2px]')
    expect(assetRequests[0]?.searchParams.get('date')).toBe('2024-05-09')
  })

  it('day_header_shows_reaction_counts', async () => {
    renderDay({
      day: () => json(200, detail({ like_count: 4, comment_count: 2 })),
    })

    await screen.findByRole('heading', { name: '2024년 5월 9일 목요일' })
    const header = within(screen.getByRole('banner'))
    expect(
      await header.findByRole('img', { name: '하트 4개, 댓글 2개' }),
    ).toHaveTextContent('42')
  })

  it('title_omits_year_in_current_year', async () => {
    vi.useFakeTimers({
      shouldAdvanceTime: true,
      now: new Date('2024-05-10T03:00:00Z'),
    })
    renderDay({})

    expect(
      await screen.findByRole('heading', { name: '5월 9일 목요일' }),
    ).toBeInTheDocument()
  })

  it('infinite_scroll_loads_next_page', async () => {
    const { assetRequests } = renderDay({
      assets: (url) =>
        url.searchParams.get('cursor')
          ? { items: items(2, 100), next_cursor: null }
          : { items: items(100), next_cursor: 'c1' },
    })
    await screen.findAllByRole('link', { name: /^사진,/ })

    intersectAll()

    await waitFor(() => {
      expect(screen.getAllByRole('link', { name: /^사진,/ })).toHaveLength(102)
    })
    expect(assetRequests[1]?.searchParams.get('cursor')).toBe('c1')
  })

  it('prev_next_links', async () => {
    const { router, user } = renderDay({ path: '/days/2024-05-09?baby=b' })
    const nav = within(
      await screen.findByRole('navigation', { name: ko.day.nav }),
    )

    // 이전 = 더 과거, 다음 = 더 최근. 필터 유지.
    expect(nav.getByRole('link', { name: ko.day.prev })).toHaveAttribute(
      'href',
      '/days/2024-05-07?baby=b',
    )
    expect(nav.getByRole('link', { name: ko.day.next })).toHaveAttribute(
      'href',
      '/days/2024-05-10?baby=b',
    )
    await user.click(nav.getByRole('link', { name: ko.day.next }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/days/2024-05-10')
    })
    cleanup()

    // 없으면 숨김.
    renderDay({ day: () => json(200, detail({ prev_date: null })) })
    const nav2 = within(
      await screen.findByRole('navigation', { name: ko.day.nav }),
    )
    expect(nav2.queryByRole('link', { name: ko.day.prev })).toBeNull()
    expect(nav2.getByRole('link', { name: ko.day.next })).toBeInTheDocument()
  })

  it('baby_filter_kept', async () => {
    const { assetRequests, dayRequests } = renderDay({
      path: '/days/2024-05-09?baby=b',
    })
    const tiles = await screen.findAllByRole('link', { name: /^사진,/ })

    expect(dayRequests[0]?.searchParams.get('baby_id')).toBe('b')
    expect(assetRequests[0]?.searchParams.get('baby_id')).toBe('b')
    expect(tiles[0]).toHaveAttribute('href', '/photos/a0?baby=b')
  })

  it('empty_day_shows_message', async () => {
    const { router, user } = renderDay({
      day: () => apiError(404, 'day.notFound'),
    })

    expect(await screen.findByText(ko.day.empty)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^사진,/ })).toBeNull()
    await user.click(screen.getByRole('link', { name: ko.day.home }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/')
    })
  })

  it('invalid_date_redirects', async () => {
    for (const bad of ['2024-13-01', '2024-02-30', 'abc', '2024-5-9']) {
      const { router } = renderDay({ path: `/days/${bad}?baby=b` })
      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/')
      })
      // 필터는 유지.
      expect(router.state.location.search).toEqual({ baby: 'b' })
      cleanup()
    }
  })

  it('back_goes_home_when_entered_directly', async () => {
    const { router, user } = renderDay({ path: '/days/2024-05-09?baby=b' })

    await user.click(await screen.findByRole('button', { name: ko.day.back }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/')
    })
    expect(router.state.location.search).toEqual({ baby: 'b' })
  })

  it('day_page_stories_after_grid', async () => {
    renderDay({
      day: () =>
        json(
          200,
          detail({
            milestones: [milestoneFixture('m1', { achieved_on: '2024-05-09' })],
            stories: [
              storyFixture('s1', {
                entry_date: '2024-05-09',
                body: '처음 뒤집었어요',
              }),
            ],
          }),
        ),
    })
    // 머리글 날짜 옆 마일스톤. 제목 이름은 날짜만.
    await screen.findByRole('heading', { name: '2024년 5월 9일 목요일' })
    const header = within(screen.getByRole('banner'))
    expect(await header.findByText('· 🎉 첫 이')).toBeInTheDocument()

    const tiles = await screen.findAllByRole('link', { name: /^사진,/ })
    const story = screen.getByRole('link', {
      name: 'guardian 이야기: 처음 뒤집었어요',
    })
    expect(story).toHaveAttribute('href', '/stories/s1')
    const follows =
      (tiles.at(-1)?.compareDocumentPosition(story) ?? 0) &
      Node.DOCUMENT_POSITION_FOLLOWING
    expect(follows).not.toBe(0)
    // 사진이 있으면 마일스톤 한 줄 없음.
    expect(screen.queryByText('guardian이(가) 기록')).toBeNull()
  })

  it('day_page_text_only', async () => {
    renderDay({
      day: () =>
        json(
          200,
          detail({
            photo_count: 0,
            video_count: 0,
            uploader_ids: [],
            milestones: [milestoneFixture('m1', { achieved_on: '2024-05-09' })],
          }),
        ),
      assets: () => ({ items: [], next_cursor: null }),
    })
    expect(await screen.findByText('guardian이(가) 기록')).toBeInTheDocument()
    expect(screen.queryByText(ko.day.empty)).toBeNull()
    expect(screen.queryByRole('link', { name: /^사진,/ })).toBeNull()
    // 사진 없는 날은 사진 목록 불러오는 중 표시 없음.
    expect(screen.queryByText(ko.common.loading)).toBeNull()
  })
})
