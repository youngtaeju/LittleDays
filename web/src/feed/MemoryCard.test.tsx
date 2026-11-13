import { cleanup, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Baby, Memory } from '@/api/types'
import { initI18n } from '@/i18n'
import { json, mockFetch } from '@/test/fetch'
import {
  assetSummaryFixture,
  babyFixture,
  dayFixture,
  settingsFixture,
  storyFixture,
  userFixture,
} from '@/test/fixtures'
import { renderApp } from '@/test/router'

const KEY = 'ld:memory-dismissed'
const SKY = babyFixture({ birth_date: '2024-01-31' })
const SEA = babyFixture({
  id: '00000000-0000-4000-8000-0000000000b2',
  name: '바다',
  birth_date: '2023-03-10',
  sort_order: 1,
})
// 인스턴스 시간대(Asia/Seoul) 2025-05-10 12:00.
const NOON = new Date('2025-05-10T03:00:00Z')

const PHOTO_MEMORY: Memory = {
  kind: 'years',
  n: 1,
  day: dayFixture('2024-05-10', {
    photo_count: 12,
    video_count: 2,
    preview: [assetSummaryFixture('m-0', { local_date: '2024-05-10' })],
  }),
}
const STORY_MEMORY: Memory = {
  kind: 'months',
  n: 3,
  day: dayFixture('2025-02-10', {
    photo_count: 0,
    preview: [],
    stories: [
      {
        ...storyFixture('s1', { entry_date: '2025-02-10' }),
        body: '처음 뒤집기 성공\n둘째 줄',
      },
    ],
  }),
}

function renderHome(opts: {
  memory: () => Memory | null | Response
  babies?: Baby[]
  path?: string
}) {
  const requests: URL[] = []
  mockFetch({
    'GET /api/auth/me': () => json(200, { user: userFixture('guardian') }),
    'GET /api/settings': () => json(200, settingsFixture),
    'GET /api/babies': () => json(200, opts.babies ?? [SKY]),
    'GET /api/users': () => json(200, { users: [userFixture('guardian')] }),
    'GET /api/days': () => json(200, { items: [], next_cursor: null }),
    'GET /api/memories': (req) => {
      requests.push(new URL(req.url))
      const m = opts.memory()
      return m instanceof Response ? m : json(200, m)
    },
  })
  return { ...renderApp(opts.path ?? '/'), requests }
}

beforeEach(() => {
  initI18n('ko')
  localStorage.clear()
  vi.useFakeTimers({ shouldAdvanceTime: true, now: NOON })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => null,
  )
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('MemoryCard', () => {
  it('photo_card', async () => {
    renderHome({ memory: () => PHOTO_MEMORY })
    const link = await screen.findByRole('link', { name: /1년 전 오늘/ })
    expect(link).toHaveAttribute('href', '/days/2024-05-10')
    expect(link).toHaveTextContent('2024년 5월 10일')
    expect(link).toHaveTextContent('사진 12장')
    expect(link.querySelector('img')).toHaveAttribute(
      'src',
      '/api/assets/m-0/preview.webp',
    )
  })

  it('dismiss_button_contrast_per_variant', async () => {
    renderHome({ memory: () => PHOTO_MEMORY })
    const onPhoto = await screen.findByRole('button', { name: '오늘은 숨기기' })
    expect(onPhoto).toHaveClass('text-white')
    cleanup()

    renderHome({ memory: () => STORY_MEMORY })
    const onSoft = await screen.findByRole('button', { name: '오늘은 숨기기' })
    expect(onSoft).toHaveClass('text-accent-ink')
    expect(onSoft).not.toHaveClass('text-white')
  })

  it('processing_cover_has_no_image', async () => {
    renderHome({
      memory: () => ({
        ...PHOTO_MEMORY,
        day: {
          ...PHOTO_MEMORY.day,
          preview: [
            assetSummaryFixture('m-0', {
              local_date: '2024-05-10',
              status: 'processing',
            }),
          ],
        },
      }),
    })
    const link = await screen.findByRole('link', { name: /1년 전 오늘/ })
    expect(link.querySelector('img')).toBeNull()
  })

  it('story_only_card', async () => {
    renderHome({ memory: () => STORY_MEMORY })
    const link = await screen.findByRole('link', { name: /3개월 전 오늘/ })
    expect(link).toHaveTextContent('처음 뒤집기 성공')
    expect(link).not.toHaveTextContent('둘째 줄')
    expect(link.querySelector('img')).toBeNull()
  })

  it('months_label', async () => {
    renderHome({ memory: () => STORY_MEMORY })
    expect(
      await screen.findByRole('link', { name: /3개월 전 오늘/ }),
    ).toBeInTheDocument()
  })

  it('dismiss_for_today', async () => {
    const { user } = renderHome({ memory: () => PHOTO_MEMORY })
    await screen.findByRole('link', { name: /1년 전 오늘/ })
    await user.click(screen.getByRole('button', { name: '오늘은 숨기기' }))
    expect(screen.queryByRole('link', { name: /1년 전 오늘/ })).toBeNull()
    expect(localStorage.getItem(KEY)).toBe('2025-05-10')
    cleanup()

    // 같은 날 다시 열어도 숨김.
    renderHome({ memory: () => PHOTO_MEMORY })
    await screen.findByRole('heading', { name: '홈', level: 1 })
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: /1년 전 오늘/ })).toBeNull()
    })
    cleanup()

    // 숨긴 날짜가 오늘이 아니면 다시 표시.
    localStorage.setItem(KEY, '2025-05-09')
    renderHome({ memory: () => PHOTO_MEMORY })
    expect(
      await screen.findByRole('link', { name: /1년 전 오늘/ }),
    ).toBeInTheDocument()
  })

  it('dismiss_without_storage', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    const { user } = renderHome({ memory: () => PHOTO_MEMORY })
    await screen.findByRole('link', { name: /1년 전 오늘/ })
    await user.click(screen.getByRole('button', { name: '오늘은 숨기기' }))
    expect(screen.queryByRole('link', { name: /1년 전 오늘/ })).toBeNull()
  })

  it('none_renders_nothing', async () => {
    const { requests } = renderHome({ memory: () => null })
    await waitFor(() => {
      expect(requests).toHaveLength(1)
    })
    await screen.findByRole('heading', { name: '홈', level: 1 })
    expect(screen.queryByRole('button', { name: '오늘은 숨기기' })).toBeNull()
    cleanup()

    const failing = renderHome({
      memory: () =>
        new Response('{"error":"server.internal"}', { status: 500 }),
    })
    await waitFor(() => {
      expect(failing.requests.length).toBeGreaterThan(0)
    })
    expect(screen.queryByRole('button', { name: '오늘은 숨기기' })).toBeNull()
  })

  it('follows_baby_chip', async () => {
    const { requests, user } = renderHome({
      memory: () => PHOTO_MEMORY,
      babies: [SKY, SEA],
    })
    await screen.findByRole('link', { name: /1년 전 오늘/ })
    expect(requests[0]?.searchParams.get('baby_id')).toBeNull()
    await user.click(screen.getByRole('button', { name: /바다/ }))
    await waitFor(() => {
      expect(requests.at(-1)?.searchParams.get('baby_id')).toBe(SEA.id)
    })
  })
})
