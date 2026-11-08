import { act, cleanup, screen, waitFor } from '@testing-library/react'
import i18next from 'i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssetPage, Baby, Role } from '@/api/types'
import { initI18n } from '@/i18n'
import ko from '@/locales/ko.json'
import { json, mockFetch } from '@/test/fetch'
import {
  apiError,
  assetFixture,
  assetSummaryFixture,
  babyFixture,
  settingsFixture,
  userFixture,
} from '@/test/fixtures'
import { intersectAll } from '@/test/intersection'
import { renderApp } from '@/test/router'
import { ageAt, formatAge } from './age'

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

function page(
  items: AssetPage['items'],
  next_cursor: string | null = null,
): AssetPage {
  return { items, next_cursor }
}

function renderTimeline(opts: {
  role?: Role
  babies?: Baby[]
  assets: (url: URL) => AssetPage
  extra?: Parameters<typeof mockFetch>[0]
  path?: string
}) {
  const requests: URL[] = []
  mockFetch({
    'GET /api/auth/me': () =>
      json(200, { user: userFixture(opts.role ?? 'guardian') }),
    'GET /api/settings': () => json(200, settingsFixture),
    'GET /api/babies': () => json(200, opts.babies ?? [babyFixture()]),
    'GET /api/assets': (req) => {
      const url = new URL(req.url)
      requests.push(url)
      return json(200, opts.assets(url))
    },
    ...opts.extra,
  })
  return { ...renderApp(opts.path ?? '/'), requests }
}

describe('TimelinePage', () => {
  it('renders_days_with_age', async () => {
    const baby = babyFixture({ birth_date: '2024-01-31' })
    renderTimeline({
      babies: [baby],
      assets: () =>
        page([
          assetSummaryFixture('a1', {
            blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
          }),
          assetSummaryFixture('a2', { local_date: '2024-05-10' }),
        ]),
    })

    expect(
      await screen.findByRole('heading', { name: '5월 10일 금요일' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: '2024년 5월' }),
    ).toBeInTheDocument()
    const age = ageAt(baby.birth_date, '2024-05-10')
    expect(age).not.toBeNull()
    if (age === null) return
    const text = formatAge(i18next.t, age)
    expect(text).toBe('3개월 10일')
    expect(await screen.findByText(text)).toBeInTheDocument()
    expect(
      screen.getAllByRole('link', { name: '사진, 5월 10일 금요일, 12:00' }),
    ).toHaveLength(2)
  })

  it('next_page_on_scroll', async () => {
    const { requests } = renderTimeline({
      assets: (url) =>
        url.searchParams.get('cursor') === 'c1'
          ? page([assetSummaryFixture('a2', { local_date: '2024-04-30' })])
          : page([assetSummaryFixture('a1')], 'c1'),
    })
    await screen.findByRole('heading', { name: '5월 10일 금요일' })
    expect(requests).toHaveLength(1)
    expect(requests[0]?.searchParams.get('limit')).toBe('100')
    expect(requests[0]?.searchParams.has('cursor')).toBe(false)

    act(() => {
      intersectAll()
    })

    expect(
      await screen.findByRole('heading', { name: '4월 30일 화요일' }),
    ).toBeInTheDocument()
    expect(requests.map((u) => u.searchParams.get('cursor'))).toEqual([
      null,
      'c1',
    ])
  })

  it('next_page_failure_shows_one_error', async () => {
    const cursors: (string | null)[] = []
    const { user } = renderTimeline({
      assets: () => page([]),
      extra: {
        'GET /api/assets': (req) => {
          const cursor = new URL(req.url).searchParams.get('cursor')
          cursors.push(cursor)
          if (cursor === null) {
            return json(200, page([assetSummaryFixture('a1')], 'c1'))
          }
          // 첫 다음 페이지 요청만 실패.
          return cursors.filter((c) => c === 'c1').length === 1
            ? apiError(500, 'server.internal')
            : json(
                200,
                page([assetSummaryFixture('a2', { local_date: '2024-04-30' })]),
              )
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
    expect(screen.getAllByText(ko.errors.server.internal)).toHaveLength(1)
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
    expect(cursors).toEqual([null, 'c1', 'c1'])
    expect(
      screen.queryByText(ko.errors.server.internal),
    ).not.toBeInTheDocument()
  })

  it('no_empty_flash_on_filter_change', async () => {
    const first = babyFixture()
    const second = babyFixture({
      id: '00000000-0000-4000-8000-0000000000b2',
      name: '바다',
      sort_order: 1,
    })
    let release: (() => void) | undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const babyIds: (string | null)[] = []
    const { user } = renderTimeline({
      babies: [first, second],
      path: `/?baby=${first.id}`,
      assets: () => page([]),
      extra: {
        'GET /api/assets': async (req) => {
          const babyId = new URL(req.url).searchParams.get('baby_id')
          babyIds.push(babyId)
          if (babyId !== second.id) return json(200, page([]))
          // 두 번째 아기 첫 페이지는 테스트가 풀 때까지 대기.
          await held
          return json(200, page([assetSummaryFixture('b1')]))
        },
      },
    })
    expect(
      await screen.findByText(ko.timeline.emptyFiltered),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '바다' }))
    await waitFor(() => {
      expect(babyIds).toEqual([first.id, second.id])
    })
    expect(
      screen.queryByText(ko.timeline.emptyFiltered),
    ).not.toBeInTheDocument()

    act(() => {
      release?.()
    })
    expect(
      await screen.findByRole('heading', { name: '5월 10일 금요일' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(ko.timeline.emptyFiltered),
    ).not.toBeInTheDocument()
  })

  it('baby_filter_sets_query', async () => {
    const first = babyFixture()
    const second = babyFixture({
      id: '00000000-0000-4000-8000-0000000000b2',
      name: '바다',
      sort_order: 1,
    })
    const { router, user, requests } = renderTimeline({
      babies: [first, second],
      assets: () => page([assetSummaryFixture('a1')]),
    })

    await user.click(await screen.findByRole('button', { name: '바다' }))

    await waitFor(() => {
      expect(router.state.location.search).toEqual({ baby: second.id })
    })
    await waitFor(() => {
      expect(requests.at(-1)?.searchParams.get('baby_id')).toBe(second.id)
    })
    expect(screen.getByRole('button', { name: '바다' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  function processingRoutes(id: string, onPoll: () => number) {
    return {
      assets: () =>
        page([
          assetSummaryFixture(id, {
            status: 'processing',
            derivatives: {},
            dominant_color: null,
          }),
        ]),
      extra: {
        [`GET /api/assets/${id}`]: () =>
          json(
            200,
            onPoll() === 1
              ? assetFixture(id, { status: 'processing', derivatives: {} })
              : assetFixture(id),
          ),
      },
    }
  }

  it('processing_tile_polls_until_ready', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const id = 'a1'
    let polls = 0
    renderTimeline(processingRoutes(id, () => (polls += 1)))

    expect(
      await screen.findByRole('img', { name: ko.timeline.processing }),
    ).toBeInTheDocument()
    expect(document.querySelector('img[src$="thumb.webp"]')).toBeNull()
    const link = screen.getByRole('link', {
      name: `사진, 5월 10일 금요일, 12:00, ${ko.timeline.processing}`,
    })

    // 화면에 들어오면 즉시 1회, 이후 5초 간격.
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
        document.querySelector(`img[src$="/api/assets/${id}/thumb.webp"]`),
      ).not.toBeNull()
    })
    expect(
      screen.queryByRole('img', { name: ko.timeline.processing }),
    ).not.toBeInTheDocument()
    expect(polls).toBe(2)
    // 처리 완료 후에도 같은 링크 노드(다시 마운트 안 됨, 포커스 유지).
    expect(
      screen.getByRole('link', { name: '사진, 5월 10일 금요일, 12:00' }),
    ).toBe(link)

    // 준비 완료 후 폴링 종료.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })
    expect(polls).toBe(2)
  })

  it('offscreen_processing_tile_does_not_poll', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let polls = 0
    renderTimeline(processingRoutes('a1', () => (polls += 1)))

    expect(
      await screen.findByRole('img', { name: ko.timeline.processing }),
    ).toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })
    expect(polls).toBe(0)
  })

  it('failed_tile_shows_warning', async () => {
    renderTimeline({
      assets: () =>
        page([
          assetSummaryFixture('a1', { status: 'failed', derivatives: {} }),
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

  it('day_header_names_up_to_two_tagged_babies', async () => {
    initI18n('en')
    const sky = babyFixture({ birth_date: '2024-01-31' })
    const sea = babyFixture({
      id: '00000000-0000-4000-8000-0000000000b2',
      name: '바다',
      birth_date: '2023-03-10',
      sort_order: 1,
    })
    const star = babyFixture({
      id: '00000000-0000-4000-8000-0000000000b3',
      name: '별',
      birth_date: '2023-01-01',
      sort_order: 2,
    })
    renderTimeline({
      babies: [sky, sea, star],
      assets: () =>
        page([
          // 태그 순서와 무관하게 sort_order 순 앞 2명.
          assetSummaryFixture('a1', { baby_ids: [star.id, sea.id, sky.id] }),
          assetSummaryFixture('a2', {
            local_date: '2024-05-09',
            baby_ids: [sky.id],
          }),
          assetSummaryFixture('a3', { local_date: '2024-05-08', baby_ids: [] }),
        ]),
      extra: {
        'GET /api/auth/me': () =>
          json(200, { user: { ...userFixture('guardian'), locale: 'en' } }),
      },
    })

    // 문자열은 en.json 의 age.* 값 기준.
    expect(
      await screen.findByText('하늘 3 mo 10 d · 바다 1 y 2 mo'),
    ).toBeInTheDocument()
    expect(screen.getByText('하늘 Day 99')).toBeInTheDocument()
    // 태그된 아기가 없는 날은 나이 줄 없음.
    const untagged = screen.getByRole('heading', {
      name: 'Wednesday, May 8',
    })
    expect(untagged.parentElement?.querySelector('p')).toBeNull()
  })

  it('empty_state_for_family_has_no_upload_button', async () => {
    renderTimeline({ role: 'family', assets: () => page([]) })

    expect(await screen.findByText(ko.timeline.empty)).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: ko.timeline.upload }),
    ).not.toBeInTheDocument()
    cleanup()

    renderTimeline({ role: 'guardian', assets: () => page([]) })
    expect(await screen.findByText(ko.timeline.empty)).toBeInTheDocument()
    expect(
      await screen.findByRole('link', { name: ko.timeline.upload }),
    ).toHaveAttribute('href', '/upload')
  })
})
