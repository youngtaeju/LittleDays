import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Baby, BabyStats, Role } from '@/api/types'
import { initI18n } from '@/i18n'
import { json, mockFetch } from '@/test/fetch'
import {
  apiError,
  assetSummaryFixture,
  babyFixture,
  settingsFixture,
  userFixture,
} from '@/test/fixtures'
import { renderApp } from '@/test/router'

beforeEach(() => {
  initI18n('ko')
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => null,
  )
  // 인스턴스 시간대(Asia/Seoul) 2026-11-10 12:00.
  vi.useFakeTimers({
    shouldAdvanceTime: true,
    now: new Date('2026-11-10T03:00:00Z'),
  })
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const SKY = babyFixture({ birth_date: '2025-09-26' })
const SEA = babyFixture({
  id: '00000000-0000-4000-8000-0000000000b2',
  name: '바다',
  birth_date: '2026-08-10',
  sort_order: 1,
})

function stats(over: Partial<BabyStats> = {}): BabyStats {
  return {
    photo_count: 120,
    video_count: 8,
    day_count: 45,
    age_months: [
      {
        age_month: 13,
        count: 128,
        cover: assetSummaryFixture('c13', { local_date: '2026-11-01' }),
        from: '2026-10-26',
        to: '2026-11-25',
      },
      {
        age_month: 0,
        count: 3,
        cover: assetSummaryFixture('c0', { local_date: '2025-10-01' }),
        from: '2025-09-26',
        to: '2025-10-25',
      },
      {
        age_month: -1,
        count: 2,
        cover: assetSummaryFixture('cb', { local_date: '2025-09-01' }),
        from: null,
        to: '2025-09-25',
      },
    ],
    ...over,
  }
}

function renderBabies(
  path: string,
  babies: Baby[],
  opts: { role?: Role; stats?: BabyStats } = {},
) {
  const statsRequests: string[] = []
  mockFetch({
    'GET /api/auth/me': () =>
      json(200, { user: userFixture(opts.role ?? 'guardian') }),
    'GET /api/settings': () => json(200, settingsFixture),
    'GET /api/babies': () => json(200, babies),
    ...Object.fromEntries(
      babies.map((b) => [
        `GET /api/babies/${b.id}/stats`,
        () => {
          statsRequests.push(b.id)
          return json(200, opts.stats ?? stats())
        },
      ]),
    ),
    ...Object.fromEntries(
      babies.flatMap((b) => [
        [`GET /api/babies/${b.id}/growth`, () => json(200, [])],
        [`GET /api/babies/${b.id}/milestones`, () => json(200, [])],
      ]),
    ),
  })
  return { ...renderApp(path), statsRequests }
}

describe('BabyProfilePage', () => {
  it('redirects_to_last_baby', async () => {
    localStorage.setItem('ld.baby.last', SEA.id)
    const { router } = renderBabies('/babies', [SKY, SEA])
    expect(
      await screen.findByRole('heading', { level: 1, name: '바다' }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/babies/${SEA.id}`)
    cleanup()

    // 저장된 아기가 지워졌으면 첫째.
    localStorage.setItem('ld.baby.last', 'gone')
    const second = renderBabies('/babies', [SKY, SEA])
    expect(
      await screen.findByRole('heading', { level: 1, name: '하늘' }),
    ).toBeInTheDocument()
    expect(second.router.state.location.pathname).toBe(`/babies/${SKY.id}`)
  })

  it('unknown_baby_goes_to_first', async () => {
    const { router } = renderBabies('/babies/nope', [SKY])
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/babies/${SKY.id}`)
    })
  })

  it('switcher_only_when_multiple', async () => {
    renderBabies(`/babies/${SKY.id}`, [SKY])
    await screen.findByRole('heading', { level: 1, name: '하늘' })
    expect(screen.queryByRole('navigation', { name: '아기 선택' })).toBeNull()
    cleanup()

    const { user, router } = renderBabies(`/babies/${SKY.id}`, [SKY, SEA])
    const nav = await screen.findByRole('navigation', { name: '아기 선택' })
    expect(within(nav).getByRole('link', { name: '하늘' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    const sea = within(nav).getByRole('link', { name: '바다' })
    expect(sea).not.toHaveAttribute('aria-current')
    await user.click(sea)
    expect(
      await screen.findByRole('heading', { level: 1, name: '바다' }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/babies/${SEA.id}`)
    expect(localStorage.getItem('ld.baby.last')).toBe(SEA.id)
  })

  it('profile_numbers', async () => {
    renderBabies(`/babies/${SKY.id}`, [SKY])
    await screen.findByRole('heading', { level: 1, name: '하늘' })
    expect(
      screen.getByText('1살 1개월 · 2025년 9월 26일생'),
    ).toBeInTheDocument()
    // 태어난 날 = 1일째.
    expect(screen.getByText('D+411')).toBeInTheDocument()
    const numbers = await screen.findByRole('list', { name: '기록' })
    const items = within(numbers).getAllByRole('listitem')
    expect(items.map((li) => li.textContent)).toEqual([
      '120사진',
      '8영상',
      '45기록한 날',
    ])
  })

  it('month_card_labels', async () => {
    renderBabies(`/babies/${SKY.id}`, [SKY])
    const albums = await screen.findByRole('region', { name: '개월별 앨범' })
    const cards = await within(albums).findAllByRole('link')
    expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual([
      '13개월, 128장',
      '첫 달, 3장',
      '태어나기 전, 2장',
    ])
    expect(cards.map((c) => c.getAttribute('href'))).toEqual([
      `/babies/${SKY.id}/age/13`,
      `/babies/${SKY.id}/age/0`,
      `/babies/${SKY.id}/age/before`,
    ])
    // 표지: ready 는 썸네일, 처리 중은 이미지 없이 표시.
    expect(cards[0]?.querySelector('img')).toHaveAttribute(
      'src',
      '/api/assets/c13/thumb.webp',
    )
  })

  it('processing_cover_has_no_image', async () => {
    renderBabies(`/babies/${SKY.id}`, [SKY], {
      stats: stats({
        age_months: [
          {
            age_month: 13,
            count: 1,
            cover: assetSummaryFixture('p1', { status: 'processing' }),
            from: '2026-10-26',
            to: '2026-11-25',
          },
        ],
      }),
    })
    const card = await screen.findByRole('link', { name: '13개월, 1장' })
    expect(card.querySelector('img')).toBeNull()
    expect(
      within(card).getByRole('img', { name: '처리 중' }),
    ).toBeInTheDocument()
  })

  it('next_anniversary_line', async () => {
    // 2026-08-10 생, 오늘 93일째 → 100일까지 7일.
    renderBabies(`/babies/${SEA.id}`, [SEA])
    await screen.findByRole('heading', { level: 1, name: '바다' })
    expect(screen.getByText('D+93')).toBeInTheDocument()
    expect(screen.getByText('100일까지 7일')).toBeInTheDocument()
  })

  it('due_baby_shows_d_minus', async () => {
    const due = babyFixture({ birth_date: '2026-12-01' })
    renderBabies(`/babies/${due.id}`, [due], {
      stats: stats({
        photo_count: 0,
        video_count: 0,
        day_count: 0,
        age_months: [],
      }),
    })
    await screen.findByRole('heading', { level: 1, name: '하늘' })
    expect(screen.getByText('D-21')).toBeInTheDocument()
    expect(screen.getByText('2026년 12월 1일 출산 예정')).toBeInTheDocument()
  })

  it('empty_babies_by_role', async () => {
    const { user } = renderBabies('/babies', [])
    expect(await screen.findByText('아기를 추가해 주세요')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '아기 추가' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    cleanup()

    renderBabies('/babies', [], { role: 'family' })
    expect(
      await screen.findByText('아직 등록된 아기가 없어요'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '아기 추가' })).toBeNull()
  })
  // 첫 조회 실패 후 다시 받는 중. 설정 확정 전엔 이동 보류(첫째로 갔다 바뀌지 않게).
  it('index_waits_for_settings', async () => {
    let babiesCalls = 0
    let settingsCalls = 0
    let resolveSettings: (r: Response) => void = () => undefined
    mockFetch({
      'GET /api/auth/me': () => json(200, { user: userFixture('guardian') }),
      'GET /api/settings': () => {
        settingsCalls += 1
        if (settingsCalls === 1) return apiError(500, 'internal')
        return new Promise<Response>((resolve) => {
          resolveSettings = resolve
        })
      },
      'GET /api/babies': () => {
        babiesCalls += 1
        return babiesCalls === 1
          ? apiError(500, 'internal')
          : json(200, [SKY, SEA])
      },
      ...Object.fromEntries(
        [SKY, SEA].flatMap((b) => [
          [`GET /api/babies/${b.id}/stats`, () => json(200, stats())],
          [`GET /api/babies/${b.id}/growth`, () => json(200, [])],
          [`GET /api/babies/${b.id}/milestones`, () => json(200, [])],
        ]),
      ),
    })
    const { router } = renderApp('/babies')
    await waitFor(() => {
      expect(babiesCalls).toBe(2)
      expect(settingsCalls).toBe(2)
    })
    expect(await screen.findByText('불러오는 중…')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/babies')

    resolveSettings(json(200, { ...settingsFixture, primary_baby_id: SEA.id }))
    expect(
      await screen.findByRole('heading', { level: 1, name: '바다' }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/babies/${SEA.id}`)
  })
})
