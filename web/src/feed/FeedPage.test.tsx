import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Baby, DayPage, DaySummary, Role, User } from '@/api/types'
import { initI18n } from '@/i18n'
import ko from '@/locales/ko.json'
import { json, mockFetch } from '@/test/fetch'
import {
  apiError,
  assetFixture,
  assetSummaryFixture,
  babyFixture,
  dayFixture,
  milestoneFixture,
  settingsFixture,
  storyFixture,
  userFixture,
} from '@/test/fixtures'
import { intersectAll } from '@/test/intersection'
import { renderApp } from '@/test/router'
import { singleAspect } from './Mosaic'

beforeEach(() => {
  initI18n('ko')
  // jsdom 은 canvas 미구현. 미구현 경고 출력 방지.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => null,
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const SKY = babyFixture({ birth_date: '2024-01-31' })
const SEA = babyFixture({
  id: '00000000-0000-4000-8000-0000000000b2',
  name: '바다',
  birth_date: '2023-03-10',
  sort_order: 1,
})

// 인스턴스 시간대(Asia/Seoul) 2024-05-10 12:00.
const NOON_0510 = new Date('2024-05-10T03:00:00Z')

function page(items: DaySummary[], next_cursor: string | null = null): DayPage {
  return { items, next_cursor }
}

function user(n: number, display_name: string): User {
  return {
    ...userFixture('guardian'),
    id: `00000000-0000-4000-8000-00000000000${String(n)}`,
    username: `u${String(n)}`,
    display_name,
  }
}

function renderFeed(opts: {
  role?: Role
  babies?: Baby[]
  days: (url: URL) => DayPage
  users?: User[]
  extra?: Parameters<typeof mockFetch>[0]
  path?: string
}) {
  const requests: URL[] = []
  mockFetch({
    'GET /api/auth/me': () =>
      json(200, { user: userFixture(opts.role ?? 'guardian') }),
    'GET /api/settings': () => json(200, settingsFixture),
    'GET /api/babies': () => json(200, opts.babies ?? [SKY]),
    'GET /api/users': () =>
      json(200, { users: opts.users ?? [userFixture('guardian')] }),
    'GET /api/memories': () => json(200, null),
    'GET /api/days': (req) => {
      const url = new URL(req.url)
      requests.push(url)
      return json(200, opts.days(url))
    },
    ...opts.extra,
  })
  return { ...renderApp(opts.path ?? '/'), requests }
}

// 하루 묶음. 이름은 날짜 머리글.
function day(name: string) {
  return screen.getByRole('article', { name })
}

function previewOf(date: string, n: number) {
  return Array.from({ length: n }, (_, i) =>
    assetSummaryFixture(`${date}-${String(i)}`, { local_date: date }),
  )
}

describe('FeedPage', () => {
  it('mosaic_layouts', async () => {
    renderFeed({
      days: () =>
        page([
          dayFixture('2024-05-10', { photo_count: 1 }),
          dayFixture('2024-05-09', {
            photo_count: 2,
            preview: previewOf('2024-05-09', 2),
          }),
          dayFixture('2024-05-08', {
            photo_count: 3,
            preview: previewOf('2024-05-08', 3),
          }),
          dayFixture('2024-05-07', {
            photo_count: 3,
            video_count: 1,
            preview: previewOf('2024-05-07', 3),
          }),
          dayFixture('2024-05-06', {
            photo_count: 20,
            preview: previewOf('2024-05-06', 3),
          }),
        ]),
    })
    await screen.findByRole('heading', { name: '5월 10일 금요일' })

    const cells = (name: string) =>
      within(day(name)).getAllByRole('listitem').length
    expect(cells('5월 10일 금요일')).toBe(1)
    expect(cells('5월 9일 목요일')).toBe(2)
    expect(cells('5월 8일 수요일')).toBe(3)
    expect(cells('5월 7일 화요일')).toBe(3)
    expect(cells('5월 6일 월요일')).toBe(3)

    // 3장이면 +N 없음. 4장 이상이면 세 번째 칸이 그날 화면 링크.
    expect(within(day('5월 8일 수요일')).queryByText(/^\+/)).toBeNull()
    expect(
      within(day('5월 8일 수요일')).getAllByRole('link', { name: /^사진,/ }),
    ).toHaveLength(3)
    expect(within(day('5월 7일 화요일')).getByText('+2')).toBeInTheDocument()
    const twenty = day('5월 6일 월요일')
    expect(within(twenty).getByText('+18')).toBeInTheDocument()
    expect(
      within(twenty).getAllByRole('link', { name: /^사진,/ }),
    ).toHaveLength(2)

    // 1장: 원본 비율, 세로 4:5 · 가로 16:9 범위. 크기 모르면 4:3.
    expect(singleAspect(4032, 3024)).toBeCloseTo(4 / 3)
    expect(singleAspect(3024, 4032)).toBeCloseTo(4 / 5)
    expect(singleAspect(8000, 2000)).toBeCloseTo(16 / 9)
    expect(singleAspect(1080, 1350)).toBeCloseTo(4 / 5)
    expect(singleAspect(null, 3024)).toBeCloseTo(4 / 3)
    expect(singleAspect(4032, 0)).toBeCloseTo(4 / 3)
  })

  it('age_line_variants', async () => {
    // 아기 1명: 나이만.
    renderFeed({
      days: () =>
        page([
          dayFixture('2024-05-10', { baby_ids: [SKY.id] }),
          // 태어난 날 = 1일째. 100일은 배지가 나이 줄 대체.
          dayFixture('2024-05-09', { baby_ids: [SKY.id] }),
        ]),
    })
    await screen.findByRole('heading', { name: '5월 10일 금요일' })
    expect(
      within(day('5월 10일 금요일')).getByText('3개월 10일'),
    ).toBeInTheDocument()
    const special = day('5월 9일 목요일')
    expect(within(special).getByText('100일')).toBeInTheDocument()
    expect(within(special).queryByText('3개월 9일')).toBeNull()
    cleanup()

    // 전체 + 2명: 그날 태그된 아기만 이름과 함께, 아기 순서대로.
    renderFeed({
      babies: [SKY, SEA],
      days: () =>
        page([
          dayFixture('2024-05-10', { baby_ids: [SKY.id, SEA.id] }),
          dayFixture('2024-05-08', { baby_ids: [SEA.id] }),
          dayFixture('2024-05-07', { baby_ids: [] }),
        ]),
    })
    await screen.findByRole('heading', { name: '5월 10일 금요일' })
    expect(
      within(day('5월 10일 금요일')).getByText(
        '하늘 3개월 10일 · 바다 1살 2개월',
      ),
    ).toBeInTheDocument()
    expect(
      within(day('5월 8일 수요일')).getByText('바다 1살 1개월'),
    ).toBeInTheDocument()
    expect(within(day('5월 7일 화요일')).queryByText(/개월|생후/)).toBeNull()
    cleanup()

    // 필터로 1명: 이름 없이 그 아기 나이.
    renderFeed({
      babies: [SKY, SEA],
      path: `/?baby=${SEA.id}`,
      days: () => page([dayFixture('2024-05-10', { baby_ids: [SEA.id] })]),
    })
    await screen.findByRole('heading', { name: '5월 10일 금요일' })
    expect(
      within(day('5월 10일 금요일')).getByText('1살 2개월'),
    ).toBeInTheDocument()
    cleanup()

    // 생일 전: 출산 예정 D-.
    renderFeed({
      babies: [babyFixture({ birth_date: '2024-06-01' })],
      days: () => page([dayFixture('2024-05-10')]),
    })
    await screen.findByRole('heading', { name: '5월 10일 금요일' })
    expect(
      within(day('5월 10일 금요일')).getByText('출산 예정 D-22'),
    ).toBeInTheDocument()
  })

  it('uploader_line', async () => {
    const mom = user(1, '엄마')
    const dad = user(2, '아빠')
    const junyoung = user(3, '준영')
    renderFeed({
      users: [mom, dad, junyoung],
      days: () =>
        page([
          dayFixture('2024-05-10', {
            uploader_ids: [junyoung.id],
            photo_count: 3,
            preview: previewOf('2024-05-10', 3),
          }),
          // 순서 무의미. 멤버 목록 순서로.
          dayFixture('2024-05-09', {
            uploader_ids: [dad.id, mom.id],
            photo_count: 1,
            video_count: 2,
          }),
          dayFixture('2024-05-08', {
            uploader_ids: [junyoung.id, dad.id, mom.id],
            photo_count: 0,
            video_count: 1,
          }),
          // 탈퇴 등으로 모르는 사용자는 생략.
          dayFixture('2024-05-07', {
            uploader_ids: ['00000000-0000-4000-8000-0000000000ff'],
            photo_count: 2,
          }),
        ]),
    })
    await screen.findByRole('heading', { name: '5월 10일 금요일' })

    const line = (date: string, name: string) => {
      const link = screen.getByRole('link', { name })
      expect(link).toHaveAttribute('href', `/days/${date}`)
    }
    await waitFor(() => {
      line('2024-05-10', '준영이 올림 · 사진 3장')
    })
    line('2024-05-09', '엄마, 아빠가 올림 · 사진 1장 · 영상 2개')
    line('2024-05-08', '엄마 외 2명이 올림 · 영상 1개')
    line('2024-05-07', '사진 2장')
  })

  it('today_yesterday_labels', async () => {
    // UTC 로는 5월 9일. 인스턴스 시간대(서울) 기준 5월 10일 00:30.
    vi.useFakeTimers({
      shouldAdvanceTime: true,
      now: new Date('2024-05-09T15:30:00Z'),
    })
    renderFeed({
      days: () =>
        page([
          dayFixture('2024-05-10'),
          dayFixture('2024-05-09'),
          dayFixture('2024-05-08'),
        ]),
    })

    expect(
      await screen.findByRole('heading', { name: ko.feed.today }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: ko.feed.yesterday }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: '5월 8일 수요일' }),
    ).toBeInTheDocument()
    // 달이 바뀔 때만 월 제목.
    expect(screen.getAllByRole('heading', { name: '2024년 5월' })).toHaveLength(
      1,
    )
  })

  it('photo_click_opens_viewer', async () => {
    const { router, user } = renderFeed({
      path: `/?baby=${SKY.id}`,
      days: () => page([dayFixture('2024-05-10', { baby_ids: [SKY.id] })]),
      extra: {
        'GET /api/assets': () =>
          json(200, {
            items: [assetSummaryFixture('2024-05-10-a')],
            next_cursor: null,
          }),
        'GET /api/assets/2024-05-10-a': () =>
          json(200, assetFixture('2024-05-10-a')),
      },
    })
    const photo = await screen.findByRole('link', {
      name: '사진, 5월 10일 금요일, 12:00',
    })
    expect(photo).toHaveAttribute('href', `/photos/2024-05-10-a?baby=${SKY.id}`)

    await user.click(photo)

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/photos/2024-05-10-a')
    })
    expect(router.state.location.search).toEqual({ baby: SKY.id })
  })

  it('plus_n_opens_day', async () => {
    const { router, user } = renderFeed({
      path: `/?baby=${SKY.id}`,
      extra: {
        'GET /api/days/2024-05-10': () =>
          json(200, {
            date: '2024-05-10',
            photo_count: 18,
            video_count: 2,
            uploader_ids: [],
            baby_ids: [],
            prev_date: null,
            next_date: null,
          }),
        'GET /api/assets': () => json(200, { items: [], next_cursor: null }),
      },
      days: () =>
        page([
          dayFixture('2024-05-10', {
            photo_count: 18,
            video_count: 2,
            preview: previewOf('2024-05-10', 3),
          }),
        ]),
    })
    await screen.findByRole('heading', { name: '5월 10일 금요일' })
    const href = `/days/2024-05-10?baby=${SKY.id}`

    const all = screen.getByRole('link', {
      name: '5월 10일 금요일 20개 모두 보기',
    })
    expect(all).toHaveAttribute('href', href)
    // 날짜 머리글, 아래 줄도 그날 화면.
    expect(
      screen.getByRole('link', { name: '5월 10일 금요일' }),
    ).toHaveAttribute('href', href)
    expect(
      await screen.findByRole('link', {
        name: 'guardian이(가) 올림 · 사진 18장 · 영상 2개',
      }),
    ).toHaveAttribute('href', href)

    await user.click(all)

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/days/2024-05-10')
    })
    expect(router.state.location.search).toEqual({ baby: SKY.id })
  })

  it('header_single_vs_multi', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: NOON_0510 })
    // 1명: 우리 집 이름 + 아기 알약(태어난 날 = 1일째).
    renderFeed({ days: () => page([]) })
    let header = within(await screen.findByRole('banner'))
    expect(await header.findByText(SKY.name)).toBeInTheDocument()
    expect(header.getByText(settingsFixture.instance_name)).toBeInTheDocument()
    expect(header.getByText('D+101')).toBeInTheDocument()
    expect(header.queryByRole('group')).toBeNull()
    cleanup()

    // 출산 전: D-.
    renderFeed({
      babies: [babyFixture({ birth_date: '2024-06-01' })],
      days: () => page([]),
    })
    header = within(await screen.findByRole('banner'))
    expect(await header.findByText('D-22')).toBeInTheDocument()
    cleanup()

    // 2명: 우리 집 이름 + 아기 칩. 전체면 대표 아기(설정 없으면 첫째) 배지.
    const { router, user, requests } = renderFeed({
      babies: [SKY, SEA],
      days: () => page([]),
    })
    header = within(await screen.findByRole('banner'))
    const chips = within(
      await header.findByRole('group', { name: ko.feed.babyFilter }),
    )
    expect(header.getByText(settingsFixture.instance_name)).toBeInTheDocument()
    expect(chips.getByRole('button', { name: ko.feed.all })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(header.getByText('D+101')).toBeInTheDocument()

    await user.click(chips.getByRole('button', { name: SEA.name }))

    await waitFor(() => {
      expect(router.state.location.search).toEqual({ baby: SEA.id })
    })
    await waitFor(() => {
      expect(requests.at(-1)?.searchParams.get('baby_id')).toBe(SEA.id)
    })
    expect(chips.getByRole('button', { name: SEA.name })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    // 고른 아기 기준 D+. 2023-03-10 생 → 2024-05-10 은 428일째.
    expect(header.getByText('D+428')).toBeInTheDocument()
    expect(header.queryByText('D+101')).toBeNull()
  })

  it('empty_state_by_role', async () => {
    renderFeed({ role: 'family', days: () => page([]) })

    expect(await screen.findByText(ko.feed.emptyFamily)).toBeInTheDocument()
    expect(screen.queryByText(ko.feed.empty)).toBeNull()
    expect(
      within(screen.getByRole('main')).queryByRole('button', {
        name: ko.nav.add,
      }),
    ).not.toBeInTheDocument()
    cleanup()

    const click = vi.spyOn(HTMLInputElement.prototype, 'click')
    const { user } = renderFeed({ role: 'guardian', days: () => page([]) })
    expect(await screen.findByText(ko.feed.empty)).toBeInTheDocument()
    expect(screen.getByText(ko.feed.emptyHint)).toBeInTheDocument()
    await user.click(
      within(screen.getByRole('main')).getByRole('button', {
        name: ko.nav.add,
      }),
    )
    // 셸의 사진 선택창.
    expect(click.mock.contexts[0]).toHaveAttribute('type', 'file')
  })

  it('feed_refetches_after_trash', async () => {
    let trashed = false
    const a = assetSummaryFixture('a')
    const b = assetSummaryFixture('b')
    const { router, user, requests } = renderFeed({
      days: () =>
        page([
          dayFixture('2024-05-10', {
            photo_count: trashed ? 1 : 2,
            preview: trashed ? [b] : [a, b],
          }),
        ]),
      extra: {
        'GET /api/assets': () =>
          json(200, {
            items: trashed ? [b] : [a, b],
            next_cursor: null,
          }),
        'GET /api/assets/a': () => json(200, assetFixture('a')),
        'GET /api/assets/b': () => json(200, assetFixture('b')),
        'DELETE /api/assets/a': () => {
          trashed = true
          return json(204, null)
        },
      },
    })
    const links = await screen.findAllByRole('link', {
      name: '사진, 5월 10일 금요일, 12:00',
    })
    expect(links).toHaveLength(2)
    const first = links[0]
    if (!first) throw new Error('사진 없음')
    await user.click(first)
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/photos/a')
    })

    await user.click(
      await screen.findByRole('button', { name: ko.viewer.trashShort }),
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
    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/')
    })
    await waitFor(() => {
      expect(
        screen.getAllByRole('link', { name: '사진, 5월 10일 금요일, 12:00' }),
      ).toHaveLength(1)
    })
    expect(requests.length).toBeGreaterThanOrEqual(2)
  })

  it('next_page_on_scroll', async () => {
    const { requests } = renderFeed({
      days: (url) =>
        url.searchParams.get('cursor') === '2024-05-10'
          ? page([dayFixture('2024-04-30')])
          : page([dayFixture('2024-05-10')], '2024-05-10'),
    })
    await screen.findByRole('heading', { name: '5월 10일 금요일' })
    expect(requests).toHaveLength(1)
    expect(requests[0]?.searchParams.get('limit')).toBe('20')
    expect(requests[0]?.searchParams.has('cursor')).toBe(false)

    act(() => {
      intersectAll()
    })

    expect(
      await screen.findByRole('heading', { name: '4월 30일 화요일' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: '2024년 4월' }),
    ).toBeInTheDocument()
    expect(requests.map((u) => u.searchParams.get('cursor'))).toEqual([
      null,
      '2024-05-10',
    ])
  })

  it('next_page_failure_shows_one_error', async () => {
    const cursors: (string | null)[] = []
    const { user } = renderFeed({
      days: () => page([]),
      extra: {
        'GET /api/days': (req) => {
          const cursor = new URL(req.url).searchParams.get('cursor')
          cursors.push(cursor)
          if (cursor === null) {
            return json(200, page([dayFixture('2024-05-10')], '2024-05-10'))
          }
          // 첫 다음 페이지 요청만 실패.
          return cursors.filter((c) => c !== null).length === 1
            ? apiError(500, 'server.internal')
            : json(200, page([dayFixture('2024-04-30')]))
        },
      },
    })
    await screen.findByRole('heading', { name: '5월 10일 금요일' })

    act(() => {
      intersectAll()
    })

    expect(
      await screen.findByText(ko.errors.server.internal),
    ).toBeInTheDocument()
    expect(
      screen.getAllByRole('button', { name: ko.common.retry }),
    ).toHaveLength(1)
    // 이미 받은 목록 유지.
    expect(
      screen.getByRole('heading', { name: '5월 10일 금요일' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: ko.common.retry }))

    expect(
      await screen.findByRole('heading', { name: '4월 30일 화요일' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(ko.errors.server.internal),
    ).not.toBeInTheDocument()
  })

  it('no_empty_flash_on_filter_change', async () => {
    let release: (() => void) | undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const babyIds: (string | null)[] = []
    const { user } = renderFeed({
      babies: [SKY, SEA],
      path: `/?baby=${SKY.id}`,
      days: () => page([]),
      extra: {
        'GET /api/days': async (req) => {
          const babyId = new URL(req.url).searchParams.get('baby_id')
          babyIds.push(babyId)
          if (babyId !== SEA.id) return json(200, page([]))
          // 두 번째 아기 첫 페이지는 테스트가 풀 때까지 대기.
          await held
          return json(200, page([dayFixture('2024-05-10')]))
        },
      },
    })
    expect(await screen.findByText(ko.feed.emptyFiltered)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: SEA.name }))
    await waitFor(() => {
      expect(babyIds).toEqual([SKY.id, SEA.id])
    })
    expect(screen.queryByText(ko.feed.emptyFiltered)).not.toBeInTheDocument()

    act(() => {
      release?.()
    })
    expect(
      await screen.findByRole('heading', { name: '5월 10일 금요일' }),
    ).toBeInTheDocument()
    expect(screen.queryByText(ko.feed.emptyFiltered)).not.toBeInTheDocument()
  })

  it('processing_cell_polls_until_ready', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const id = 'a1'
    let polls = 0
    renderFeed({
      days: () =>
        page([
          dayFixture('2024-05-10', {
            preview: [
              assetSummaryFixture(id, {
                status: 'processing',
                derivatives: {},
                dominant_color: null,
              }),
            ],
          }),
        ]),
      extra: {
        [`GET /api/assets/${id}`]: () => {
          polls += 1
          return json(
            200,
            polls === 1
              ? assetFixture(id, { status: 'processing', derivatives: {} })
              : assetFixture(id),
          )
        },
      },
    })

    expect(
      await screen.findByRole('img', { name: ko.timeline.processing }),
    ).toBeInTheDocument()
    expect(document.querySelector('img[src$="thumb.webp"]')).toBeNull()

    act(() => {
      intersectAll()
    })
    await waitFor(() => {
      expect(polls).toBe(1)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    await waitFor(() => {
      expect(
        document.querySelector(`img[src*="/api/assets/${id}/"]`),
      ).not.toBeNull()
    })
    expect(
      screen.queryByRole('img', { name: ko.timeline.processing }),
    ).not.toBeInTheDocument()
  })

  it('day_card_shows_reaction_counts', async () => {
    renderFeed({
      days: () =>
        page([
          dayFixture('2024-05-10', { like_count: 12, comment_count: 5 }),
          dayFixture('2024-05-09'),
          dayFixture('2024-05-08', { like_count: 3 }),
        ]),
    })
    await screen.findByRole('heading', { name: '5월 10일 금요일' })

    const both = within(day('5월 10일 금요일')).getByRole('img', {
      name: '하트 12개, 댓글 5개',
    })
    expect(both).toHaveTextContent('12')
    expect(both).toHaveTextContent('5')
    expect(
      within(day('5월 9일 목요일')).queryByRole('img', { name: /하트|댓글/ }),
    ).toBeNull()
    const likesOnly = within(day('5월 8일 수요일')).getByRole('img', {
      name: '하트 3개',
    })
    expect(likesOnly).toHaveTextContent('3')
  })

  // 처리 전 촬영 시각은 파일 수정 시각 등. EXIF·영상 메타로 바뀌면 다른 날로 이동.
  it('processed_item_moves_day', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const id = 'a1'
    let processed = false
    const { requests } = renderFeed({
      days: () =>
        page([
          processed
            ? dayFixture('2024-04-01', {
                preview: [
                  assetSummaryFixture(id, {
                    local_date: '2024-04-01',
                    taken_at: '2024-04-01T03:00:00Z',
                  }),
                ],
              })
            : dayFixture('2024-05-10', {
                preview: [
                  assetSummaryFixture(id, {
                    status: 'processing',
                    derivatives: {},
                  }),
                ],
              }),
        ]),
      extra: {
        [`GET /api/assets/${id}`]: () => {
          processed = true
          return json(
            200,
            assetFixture(id, { taken_at: '2024-04-01T03:00:00Z' }),
          )
        },
      },
    })
    await screen.findByRole('img', { name: ko.timeline.processing })

    act(() => {
      intersectAll()
    })

    expect(
      await screen.findByRole('heading', { name: '4월 1일 월요일' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: '5월 10일 금요일' }),
    ).not.toBeInTheDocument()
    expect(requests).toHaveLength(2)
  })

  // 업로드 직후 여러 장이 함께 처리 완료. 목록 재조회는 한 번.
  it('processed_items_refetch_once', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const ids = ['a1', 'a2']
    const done = new Set<string>()
    const moved = '2024-04-01T03:00:00Z'
    const extra: Parameters<typeof mockFetch>[0] = {}
    for (const id of ids) {
      extra[`GET /api/assets/${id}`] = () => {
        done.add(id)
        return json(200, assetFixture(id, { taken_at: moved }))
      }
    }
    const { requests } = renderFeed({
      days: () =>
        page([
          done.size === ids.length
            ? dayFixture('2024-04-01', {
                photo_count: 2,
                preview: ids.map((id) =>
                  assetSummaryFixture(id, {
                    local_date: '2024-04-01',
                    taken_at: moved,
                  }),
                ),
              })
            : dayFixture('2024-05-10', {
                photo_count: 2,
                preview: ids.map((id) =>
                  assetSummaryFixture(id, {
                    status: 'processing',
                    derivatives: {},
                  }),
                ),
              }),
        ]),
      extra,
    })
    expect(
      await screen.findAllByRole('img', { name: ko.timeline.processing }),
    ).toHaveLength(2)

    act(() => {
      intersectAll()
    })

    expect(
      await screen.findByRole('heading', { name: '4월 1일 월요일' }),
    ).toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(requests).toHaveLength(2)
  })

  it('header_falls_back_to_instance_name_when_babies_fail', async () => {
    renderFeed({
      days: () => page([]),
      extra: { 'GET /api/babies': () => apiError(500, 'server.internal') },
    })
    const header = within(await screen.findByRole('banner'))
    expect(
      await header.findByText(settingsFixture.instance_name),
    ).toBeInTheDocument()
  })

  it('chips_shown_for_stale_baby_filter', async () => {
    renderFeed({ path: '/?baby=gone', days: () => page([]) })

    const header = within(await screen.findByRole('banner'))
    expect(
      await header.findByRole('group', { name: ko.feed.babyFilter }),
    ).toBeInTheDocument()
  })

  it('failed_cell_shows_warning', async () => {
    renderFeed({
      days: () =>
        page([
          dayFixture('2024-05-10', {
            preview: [
              assetSummaryFixture('a1', { status: 'failed', derivatives: {} }),
            ],
          }),
        ]),
    })

    expect(
      await screen.findByRole('img', { name: ko.timeline.failed }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', {
        name: `사진, 5월 10일 금요일, 12:00, ${ko.timeline.failed}`,
      }),
    ).toBeInTheDocument()
  })

  it('day_with_story_after_meta', async () => {
    const mom = user(1, '엄마')
    renderFeed({
      users: [mom],
      days: () =>
        page([
          dayFixture('2024-05-10', {
            uploader_ids: [mom.id],
            milestones: [
              milestoneFixture('m1', { preset_key: 'walk_alone' }),
              milestoneFixture('m2', {
                preset_key: null,
                custom_label: '첫 수영',
              }),
              milestoneFixture('m3'),
            ],
            stories: [
              storyFixture('s1', {
                author_id: mom.id,
                body: '혼자 걸었어요',
                like_count: 3,
                previews: [
                  assetSummaryFixture('2024-05-10-a', {
                    local_date: '2024-05-10',
                  }),
                ],
                asset_count: 1,
              }),
            ],
          }),
        ]),
    })
    await screen.findByRole('heading', { name: /^5월 10일 금요일/ })
    // 머리글: 날짜 옆 마일스톤 두 개 + 외 N. 하루 묶음 이름은 날짜만.
    const card = day('5월 10일 금요일')
    expect(
      within(card).getByText('· 🎉 혼자 걷기, 첫 수영 외 1'),
    ).toBeInTheDocument()

    // 모자이크 → 메타 줄 → 이야기 순서.
    const mosaic = within(card).getByRole('list')
    const meta = within(card).getByRole('link', {
      name: '엄마가 올림 · 사진 1장',
    })
    const story = within(card).getByRole('link', {
      name: '엄마 이야기: 혼자 걸었어요',
    })
    expect(story).toHaveAttribute('href', '/stories/s1')
    const body = within(card).getByText('혼자 걸었어요')
    const follows = (a: Node, b: Node) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    expect(follows(mosaic, meta)).toBe(true)
    expect(follows(meta, body)).toBe(true)
    // 이야기 아래 줄: 쓴 사람 + 반응 수(0 생략). 그날 사진은 썸네일 없음.
    const block = body.closest('[data-story]')
    if (!(block instanceof HTMLElement)) throw new Error('이야기 블록 없음')
    expect(within(block).getByText('엄마')).toBeInTheDocument()
    expect(within(block).getByRole('img', { name: '하트 3개' })).toBeVisible()
    expect(within(block).queryByText(/^사진 \d장$/)).toBeNull()
    expect(block.querySelector('img')).toBeNull()
  })

  it('text_only_day', async () => {
    const mom = user(1, '엄마')
    const dad = user(2, '아빠')
    renderFeed({
      users: [mom, dad],
      days: () =>
        page([
          dayFixture('2024-05-10', {
            photo_count: 0,
            preview: [],
            uploader_ids: [],
            baby_ids: [SKY.id],
            stories: [
              storyFixture('s1', { author_id: mom.id, body: '열이 났어요' }),
              storyFixture('s2', {
                author_id: dad.id,
                body: '다 나았어요',
                comment_count: 2,
              }),
            ],
          }),
        ]),
    })
    await screen.findByRole('heading', { name: '5월 10일 금요일' })
    const card = day('5월 10일 금요일')
    // 머리글 나이 줄, 사진 칸, 메타 줄 없음.
    expect(within(card).getByText('3개월 10일')).toBeInTheDocument()
    expect(within(card).queryByRole('list')).toBeNull()
    expect(within(card).queryByText(/올림/)).toBeNull()
    // 쓴 순서대로.
    expect(
      within(card)
        .getAllByRole('link', { name: / 이야기: / })
        .map((l) => l.getAttribute('href')),
    ).toEqual(['/stories/s1', '/stories/s2'])
    expect(within(card).getByText('열이 났어요')).toBeInTheDocument()
    expect(
      within(card).getByRole('img', { name: '댓글 2개' }),
    ).toBeInTheDocument()
  })

  it('milestone_only_day', async () => {
    const dad = user(2, '아빠')
    renderFeed({
      users: [dad],
      days: () =>
        page([
          dayFixture('2024-05-10', {
            photo_count: 0,
            preview: [],
            uploader_ids: [],
            milestones: [
              milestoneFixture('m1', {
                note: '아래 앞니 하나',
                created_by: dad.id,
              }),
            ],
          }),
          dayFixture('2024-05-09', {
            photo_count: 0,
            preview: [],
            uploader_ids: [],
            milestones: [
              milestoneFixture('m2', {
                preset_key: 'rollover',
                created_by: dad.id,
              }),
            ],
          }),
        ]),
    })
    await screen.findByRole('heading', { name: /^5월 10일 금요일/ })
    const withNote = day('5월 10일 금요일')
    expect(within(withNote).getByText('· 🎉 첫 이')).toBeInTheDocument()
    expect(within(withNote).getByText('아래 앞니 하나')).toBeInTheDocument()
    expect(within(withNote).queryByRole('list')).toBeNull()
    const noNote = day('5월 9일 목요일')
    expect(within(noNote).getByText('· 🎉 뒤집기')).toBeInTheDocument()
    expect(within(noNote).getByText('아빠가 기록')).toBeInTheDocument()
  })

  it('other_day_photos_thumbs', async () => {
    const mom = user(1, '엄마')
    const others = ['a', 'b', 'c', 'd'].map((x) =>
      assetSummaryFixture(`old-${x}`, { local_date: '2024-05-01' }),
    )
    renderFeed({
      users: [mom],
      days: () =>
        page([
          dayFixture('2024-05-10', {
            photo_count: 0,
            preview: [],
            uploader_ids: [],
            stories: [
              storyFixture('s1', {
                author_id: mom.id,
                entry_date: '2024-05-10',
                body: '지난주 바다 사진',
                previews: others,
                asset_count: 6,
              }),
            ],
          }),
        ]),
    })
    await screen.findByRole('heading', { name: '5월 10일 금요일' })
    const block = within(day('5월 10일 금요일'))
      .getByText('지난주 바다 사진')
      .closest('[data-story]')
    if (!(block instanceof HTMLElement)) throw new Error('이야기 블록 없음')
    // 썸네일 최대 4 + 전체 장수. 모자이크 칸(li)이 아님.
    expect(
      [...block.querySelectorAll('img')].map((i) => i.getAttribute('src')),
    ).toEqual(others.map((a) => `/api/assets/${a.id}/thumb.webp`))
    expect(block.querySelector('li')).toBeNull()
    expect(within(block).getByText('사진 6장')).toBeInTheDocument()
  })

  it('long_story_more', async () => {
    // jsdom 은 레이아웃 없음. 긴 글만 3줄 넘침으로 측정.
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(
      function (this: HTMLElement) {
        return this.textContent.includes('긴 이야기') ? 120 : 20
      },
    )
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(66)
    const mom = user(1, '엄마')
    const { user: u } = renderFeed({
      users: [mom],
      days: () =>
        page([
          dayFixture('2024-05-10', {
            stories: [
              storyFixture('s1', {
                author_id: mom.id,
                body: `긴 이야기 <@${mom.id}> ${'긴 이야기 '.repeat(40)}`,
              }),
              storyFixture('s2', { author_id: mom.id, body: '짧은 이야기' }),
            ],
          }),
        ]),
    })
    await screen.findByRole('heading', { name: '5월 10일 금요일' })
    const card = day('5월 10일 금요일')
    const more = await within(card).findByRole('button', {
      name: ko.stories.more,
    })
    expect(
      within(card).getAllByRole('button', { expanded: false }),
    ).toHaveLength(1)
    const long = within(card).getByText(/^긴 이야기/)
    expect(long).toHaveClass('line-clamp-3')
    expect(more).toHaveAttribute('aria-controls', long.id)
    // 상세 링크 이름: 쓴 사람 + 본문 앞 20자(멘션은 @이름).
    expect(
      within(card).getByRole('link', {
        name: '엄마 이야기: 긴 이야기 @엄마 긴 이야기 긴 이야…',
      }),
    ).toHaveAttribute('href', '/stories/s1')
    expect(
      within(card).getByRole('link', { name: '엄마 이야기: 짧은 이야기' }),
    ).toBeInTheDocument()

    // 제자리 펼침. 같은 버튼이 접기로 바뀌어 포커스 유지, 상세로 이동하지 않음.
    await u.click(more)
    expect(long).not.toHaveClass('line-clamp-3')
    expect(more).toHaveFocus()
    expect(more).toHaveAccessibleName(ko.stories.less)
    expect(more).toHaveAttribute('aria-expanded', 'true')
    expect(
      screen.getByRole('heading', { name: '5월 10일 금요일' }),
    ).toBeInTheDocument()
    await u.keyboard('{Enter}')
    expect(long).toHaveClass('line-clamp-3')
    expect(more).toHaveAccessibleName(ko.stories.more)
  })
})
