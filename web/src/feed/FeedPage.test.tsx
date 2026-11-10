import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
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
  settingsFixture,
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
    // 1명: 이름 + D+(태어난 날 = 1일째).
    renderFeed({ days: () => page([]) })
    let header = within(await screen.findByRole('banner'))
    expect(await header.findByText(SKY.name)).toBeInTheDocument()
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

    // 2명: 우리 집 이름 + 아기 칩. 전체면 배지 없음.
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
    expect(header.queryByText(/^D[+-]/)).toBeNull()

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

    fireEvent.click(await screen.findByRole('button', { name: ko.viewer.info }))
    const info = await screen.findByRole('dialog', { name: ko.viewer.info })
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
})
