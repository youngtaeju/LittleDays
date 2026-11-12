import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgeMonth, BabyStats } from '@/api/types'
import { initI18n } from '@/i18n'
import { json, mockFetch } from '@/test/fetch'
import {
  assetSummaryFixture,
  babyFixture,
  dayFixture,
  settingsFixture,
  userFixture,
} from '@/test/fixtures'
import { renderApp } from '@/test/router'

beforeEach(() => {
  initI18n('ko')
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => null,
  )
})

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

const SKY = babyFixture({ birth_date: '2025-09-26' })

const MONTH_13: AgeMonth = {
  age_month: 13,
  count: 2,
  cover: assetSummaryFixture('c13', { local_date: '2026-11-01' }),
  from: '2026-10-26',
  to: '2026-11-25',
}
const BEFORE: AgeMonth = {
  age_month: -1,
  count: 1,
  cover: assetSummaryFixture('cb', { local_date: '2025-09-01' }),
  from: null,
  to: '2025-09-25',
}

const STATS: BabyStats = {
  photo_count: 3,
  video_count: 0,
  day_count: 2,
  age_months: [MONTH_13, BEFORE],
}

function renderAlbum(path: string) {
  const dayRequests: URL[] = []
  mockFetch({
    'GET /api/auth/me': () => json(200, { user: userFixture('guardian') }),
    'GET /api/settings': () => json(200, settingsFixture),
    'GET /api/babies': () => json(200, [SKY]),
    'GET /api/users': () => json(200, { users: [userFixture('guardian')] }),
    [`GET /api/babies/${SKY.id}/stats`]: () => json(200, STATS),
    [`GET /api/babies/${SKY.id}/growth`]: () => json(200, []),
    'GET /api/days': (req) => {
      dayRequests.push(new URL(req.url))
      return json(200, {
        items: [dayFixture('2026-11-01', { baby_ids: [SKY.id] })],
        next_cursor: null,
      })
    },
  })
  return { ...renderApp(path), dayRequests }
}

describe('AgeAlbumPage', () => {
  it('age_album_range', async () => {
    const { dayRequests } = renderAlbum(`/babies/${SKY.id}/age/13`)
    const banner = await screen.findByRole('banner')
    expect(
      await within(banner).findByRole('heading', { name: '13개월' }),
    ).toBeInTheDocument()
    expect(
      within(banner).getByText('2026년 10월 26일 ~ 11월 25일'),
    ).toBeInTheDocument()
    expect(
      await screen.findByRole('article', { name: /11월 1일/ }),
    ).toBeInTheDocument()
    expect(dayRequests).toHaveLength(1)
    const q = dayRequests[0]?.searchParams
    expect(q?.get('baby_id')).toBe(SKY.id)
    expect(q?.get('from')).toBe('2026-10-26')
    expect(q?.get('to')).toBe('2026-11-25')
  })

  it('before_birth_has_no_from', async () => {
    const { dayRequests } = renderAlbum(`/babies/${SKY.id}/age/before`)
    const banner = await screen.findByRole('banner')
    expect(
      await within(banner).findByRole('heading', { name: '태어나기 전' }),
    ).toBeInTheDocument()
    expect(within(banner).getByText('~ 2025년 9월 25일')).toBeInTheDocument()
    await waitFor(() => {
      expect(dayRequests).toHaveLength(1)
    })
    const q = dayRequests[0]?.searchParams
    expect(q?.has('from')).toBe(false)
    expect(q?.get('to')).toBe('2025-09-25')
  })

  it.each(['abc', '-1', '1.5', '05', '7'])(
    'invalid_or_missing_age_%s_goes_to_profile',
    async (age) => {
      const { router } = renderAlbum(`/babies/${SKY.id}/age/${age}`)
      await waitFor(() => {
        expect(router.state.location.pathname).toBe(`/babies/${SKY.id}`)
      })
      expect(
        await screen.findByRole('heading', { level: 1, name: '하늘' }),
      ).toBeInTheDocument()
    },
  )
})
