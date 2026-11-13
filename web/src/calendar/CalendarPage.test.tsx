import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Baby, DaySummary, MonthCount } from '@/api/types'
import { initI18n } from '@/i18n'
import { json, mockFetch } from '@/test/fetch'
import {
  assetSummaryFixture,
  babyFixture,
  dayFixture,
  milestoneFixture,
  settingsFixture,
  storyFixture,
  userFixture,
} from '@/test/fixtures'
import { renderApp } from '@/test/router'

const TZ = process.env.TZ

beforeEach(() => {
  initI18n('ko')
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => null,
  )
  // 인스턴스 시간대(Asia/Seoul) 2026-11-13 12:00.
  vi.useFakeTimers({
    shouldAdvanceTime: true,
    now: new Date('2026-11-13T03:00:00Z'),
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  process.env.TZ = TZ
})

const SKY = babyFixture({ birth_date: '2025-01-31' })
const SEA = babyFixture({
  id: '00000000-0000-4000-8000-0000000000b2',
  name: '바다',
  birth_date: '2024-03-10',
  sort_order: 1,
})

function previewOf(date: string, n: number) {
  return Array.from({ length: n }, (_, i) =>
    assetSummaryFixture(`${date}-${String(i)}`, { local_date: date }),
  )
}

const DAYS: DaySummary[] = [
  dayFixture('2026-11-12', {
    photo_count: 18,
    preview: previewOf('2026-11-12', 3),
    milestones: [
      milestoneFixture('m1', {
        preset_key: 'walk_alone',
        achieved_on: '2026-11-12',
      }),
    ],
  }),
  dayFixture('2026-11-06', {
    photo_count: 0,
    preview: [],
    uploader_ids: [],
    stories: [
      storyFixture('s1', {
        entry_date: '2026-11-06',
        body: '소파에서 손 놓고 세 걸음\n둘째 줄',
      }),
    ],
  }),
  dayFixture('2026-11-02', {
    photo_count: 3,
    video_count: 1,
    preview: previewOf('2026-11-02', 3),
  }),
  dayFixture('2026-10-20', {
    photo_count: 2,
    preview: previewOf('2026-10-20', 2),
  }),
]

function renderCalendar(
  opts: {
    path?: string
    babies?: Baby[]
    months?: MonthCount[]
    extra?: Parameters<typeof mockFetch>[0]
  } = {},
) {
  const requests: URL[] = []
  mockFetch({
    'GET /api/auth/me': () => json(200, { user: userFixture('guardian') }),
    'GET /api/settings': () => json(200, settingsFixture),
    'GET /api/babies': () => json(200, opts.babies ?? [SKY]),
    'GET /api/users': () => json(200, { users: [userFixture('guardian')] }),
    'GET /api/days': (req) => {
      const url = new URL(req.url)
      requests.push(url)
      const from = url.searchParams.get('from') ?? ''
      const to = url.searchParams.get('to') ?? ''
      // 서버처럼 최신순.
      const items = DAYS.filter((d) => d.date >= from && d.date <= to)
      return json(200, { items, next_cursor: null })
    },
    'GET /api/assets/months': () => json(200, opts.months ?? []),
    ...opts.extra,
  })
  return { ...renderApp(opts.path ?? '/calendar'), requests }
}

function cell(name: string | RegExp) {
  return screen.getByRole('button', { name })
}

describe('CalendarPage', () => {
  it('cells_show_records', async () => {
    renderCalendar()
    const c12 = await screen.findByRole('button', {
      name: '11월 12일, 사진 18장, 마일스톤 혼자 걷기',
    })
    // 대표 사진 = preview[0] 썸네일. 마일스톤 ★.
    expect(c12.querySelector('img')).toHaveAttribute(
      'src',
      '/api/assets/2026-11-12-0/thumb.webp',
    )
    expect(within(c12).getByTestId('milestone-star')).toBeInTheDocument()
    expect(within(c12).queryByTestId('story-dot')).toBeNull()

    // 글만 있는 날 = 점.
    const c6 = cell('11월 6일, 이야기 1개')
    expect(c6.querySelector('img')).toBeNull()
    expect(within(c6).getByTestId('story-dot')).toBeInTheDocument()

    expect(cell('11월 2일, 사진 3장, 영상 1개').querySelector('img')).not.toBe(
      null,
    )

    // 기록 없는 날.
    const c3 = cell('11월 3일')
    expect(c3.querySelector('img')).toBeNull()
    expect(within(c3).queryByTestId('story-dot')).toBeNull()

    // 오늘 = 강조 테두리, 기본 고른 날.
    const today = cell('11월 13일')
    expect(today).toHaveAttribute('aria-current', 'date')
    expect(today).toHaveAttribute('aria-pressed', 'true')
    expect(c12).toHaveAttribute('aria-pressed', 'false')
  })

  it('select_then_open', async () => {
    const { router, user } = renderCalendar({
      extra: {
        'GET /api/days/2026-11-12': () =>
          json(200, {
            ...dayFixture('2026-11-12', { photo_count: 18 }),
            prev_date: null,
            next_date: null,
          }),
        'GET /api/assets': () => json(200, { items: [], next_cursor: null }),
      },
    })
    const c12 = await screen.findByRole('button', { name: /^11월 12일, / })
    const before = router.history.length

    await user.click(c12)

    await waitFor(() => {
      expect(router.state.location.search).toEqual({ date: '2026-11-12' })
    })
    // 고르기는 기록에 남지 않음.
    expect(router.history.length).toBe(before)
    expect(c12).toHaveAttribute('aria-pressed', 'true')
    const heading = screen.getByRole('heading', { name: /11월 12일 목요일/ })
    expect(heading).toHaveTextContent('혼자 걷기')
    // 미리보기 = 모자이크 + 그날 보기.
    expect(
      screen.getByRole('link', { name: '11월 12일 목요일 18개 모두 보기' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '그날 보기' })).toHaveAttribute(
      'href',
      '/days/2026-11-12',
    )

    // 글만 있는 날: 이야기 첫 줄.
    await user.click(cell(/^11월 6일, /))
    await screen.findByRole('heading', { name: /11월 6일 금요일/ })
    expect(screen.getByText('소파에서 손 놓고 세 걸음')).toBeInTheDocument()
    expect(screen.queryByText(/둘째 줄/)).toBeNull()

    // 고른 칸 다시 누르면 그날 화면.
    await user.click(c12)
    await user.click(c12)
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/days/2026-11-12')
    })
  })

  it('preview_empty_day', async () => {
    renderCalendar()
    // 기본 고른 날 = 오늘(기록 없음).
    await screen.findByRole('heading', { name: /11월 13일 금요일/ })
    expect(await screen.findByText('이 날은 기록이 없어요')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '그날 보기' })).toBeNull()
  })

  it('month_nav', async () => {
    const { router, user, requests } = renderCalendar()
    await screen.findByRole('heading', { name: '2026년 11월' })
    // 이번 달 다음은 못 감. 미래 칸 누를 수 없음.
    expect(screen.getByRole('button', { name: '다음 달' })).toBeDisabled()
    expect(cell('11월 14일')).toBeDisabled()
    expect(cell('11월 13일')).toBeEnabled()
    // 이전 달 미리 받기. 미래 달은 요청 없음.
    await waitFor(() => {
      expect(requests.map((u) => u.searchParams.get('from'))).toContain(
        '2026-10-01',
      )
    })
    expect(requests.map((u) => u.searchParams.get('from'))).not.toContain(
      '2026-12-01',
    )
    expect(requests[0]?.searchParams.get('to')).toBe('2026-11-30')
    expect(requests[0]?.searchParams.get('limit')).toBe('31')

    await user.click(screen.getByRole('button', { name: '이전 달' }))
    await screen.findByRole('heading', { name: '2026년 10월' })
    expect(router.state.location.search).toEqual({ month: '2026-10' })
    expect(screen.getByRole('button', { name: '다음 달' })).toBeEnabled()
    // 지난 달 기본 고른 날 = 마지막 기록한 날. 미래 아님.
    const c20 = await screen.findByRole('button', { name: /^10월 20일, / })
    expect(c20).toHaveAttribute('aria-pressed', 'true')
    expect(cell('10월 31일')).toBeEnabled()

    // 왼쪽으로 밀면 다음 달(칸 위에서 시작해도).
    fireEvent.pointerDown(c20, { pointerId: 1, clientX: 300, clientY: 200 })
    fireEvent.pointerUp(c20, { pointerId: 1, clientX: 200, clientY: 210 })
    await screen.findByRole('heading', { name: '2026년 11월' })

    // 이번 달에서 왼쪽은 그대로.
    const c13 = cell('11월 13일')
    fireEvent.pointerDown(c13, { pointerId: 1, clientX: 300, clientY: 200 })
    fireEvent.pointerUp(c13, { pointerId: 1, clientX: 200, clientY: 210 })
    expect(screen.getByRole('heading', { name: '2026년 11월' })).toBeVisible()

    // 오른쪽으로 밀면 이전 달.
    fireEvent.pointerDown(c13, { pointerId: 1, clientX: 100, clientY: 200 })
    fireEvent.pointerUp(c13, { pointerId: 1, clientX: 200, clientY: 200 })
    await screen.findByRole('heading', { name: '2026년 10월' })
  })

  it('calendar_uses_instance_today', async () => {
    // 기기 시간대 UTC 기준 11월 12일 15:30. 인스턴스(Asia/Seoul)는 11월 13일 00:30.
    process.env.TZ = 'UTC'
    vi.setSystemTime(new Date('2026-11-12T15:30:00Z'))
    renderCalendar()
    const c13 = await screen.findByRole('button', { name: '11월 13일' })
    await waitFor(() => {
      expect(c13).toHaveAttribute('aria-current', 'date')
    })
    expect(c13).toBeEnabled()
    expect(c13).toHaveAttribute('aria-pressed', 'true')
    expect(cell(/^11월 12일, /)).not.toHaveAttribute('aria-current')
    expect(cell('11월 14일')).toBeDisabled()
  })

  it.each([
    '/calendar?month=2026-13&baby=b1',
    '/calendar?month=2026-12',
    '/calendar?month=abc',
    '/calendar?date=2026-02-30',
    '/calendar?month=2026-11&date=nope',
  ])('invalid_month_redirects %s', async (path) => {
    const { router } = renderCalendar({ path })
    await waitFor(() => {
      expect(router.state.location.href).toBe('/calendar')
    })
    expect(router.history.length).toBe(1)
    await screen.findByRole('heading', { name: '2026년 11월' })
  })

  it('date_outside_month_ignored', async () => {
    const { router } = renderCalendar({
      path: '/calendar?month=2026-10&date=2026-11-12',
    })
    const c20 = await screen.findByRole('button', { name: /^10월 20일, / })
    // 달 밖 날짜는 무시. 기본 고른 날.
    await waitFor(() => {
      expect(c20).toHaveAttribute('aria-pressed', 'true')
    })
    expect(router.state.location.search).toEqual({
      month: '2026-10',
      date: '2026-11-12',
    })
    cleanup()

    // 이번 달의 미래 날짜도 무시.
    renderCalendar({ path: '/calendar?date=2026-11-20' })
    await waitFor(() => {
      expect(cell('11월 13일')).toHaveAttribute('aria-pressed', 'true')
    })
  })

  it('baby_chip_filters', async () => {
    const { router, user, requests } = renderCalendar({ babies: [SKY, SEA] })
    await screen.findByRole('heading', { name: '2026년 11월' })
    await user.click(await screen.findByRole('button', { name: '바다' }))

    await waitFor(() => {
      expect(router.state.location.search).toEqual({ baby: SEA.id })
    })
    expect(router.state.location.pathname).toBe('/calendar')
    await waitFor(() => {
      expect(
        requests.some(
          (u) =>
            u.searchParams.get('baby_id') === SEA.id &&
            u.searchParams.get('from') === '2026-11-01',
        ),
      ).toBe(true)
    })
    expect(screen.getByRole('button', { name: '바다' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('month_total_line', async () => {
    const { user } = renderCalendar()
    expect(
      await screen.findByText('사진 21 · 영상 1 · 기록한 날 3일'),
    ).toBeInTheDocument()

    // 0 항목 생략.
    await user.click(screen.getByRole('button', { name: '이전 달' }))
    expect(await screen.findByText('사진 2 · 기록한 날 1일')).toBeVisible()

    // 기록 없는 달은 줄 없음.
    await user.click(screen.getByRole('button', { name: '이전 달' }))
    await screen.findByRole('heading', { name: '2026년 9월' })
    await waitFor(() => {
      expect(screen.queryByText(/기록한 날/)).toBeNull()
    })
  })

  it('month_picker', async () => {
    const { router, user } = renderCalendar({
      months: [
        { month: '2026-11', count: 3 },
        { month: '2024-03', count: 1 },
      ],
    })
    await user.click(await screen.findByRole('button', { name: /2026년 11월/ }))
    const dialog = await screen.findByRole('dialog', { name: '달 고르기' })
    // 기록 있는 가장 오래된 해 ~ 올해.
    await within(dialog).findByRole('heading', { name: '2024년' })
    expect(
      within(dialog).getByRole('heading', { name: '2025년' }),
    ).toBeVisible()
    expect(
      within(dialog).getByRole('heading', { name: '2026년' }),
    ).toBeVisible()
    expect(within(dialog).queryByRole('heading', { name: '2023년' })).toBeNull()
    // 이번 달 이후 비활성.
    expect(
      within(dialog).getByRole('button', { name: '2026년 12월' }),
    ).toBeDisabled()
    expect(
      within(dialog).getByRole('button', { name: '2026년 11월' }),
    ).toHaveAttribute('aria-pressed', 'true')

    await user.click(within(dialog).getByRole('button', { name: '2025년 3월' }))

    await screen.findByRole('heading', { name: '2025년 3월' })
    expect(router.state.location.search).toEqual({ month: '2025-03' })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })

  it('month_picker_without_records', async () => {
    const { user } = renderCalendar({ months: [] })
    await user.click(await screen.findByRole('button', { name: /2026년 11월/ }))
    const dialog = await screen.findByRole('dialog', { name: '달 고르기' })
    // 기록 없으면 올해만.
    await within(dialog).findByRole('heading', { name: '2026년' })
    expect(within(dialog).getAllByRole('heading')).toHaveLength(2)
  })
})
