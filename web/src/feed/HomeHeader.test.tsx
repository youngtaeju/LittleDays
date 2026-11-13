import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Baby } from '@/api/types'
import { initI18n } from '@/i18n'
import ko from '@/locales/ko.json'
import { json, mockFetch } from '@/test/fetch'
import { babyFixture, settingsFixture, userFixture } from '@/test/fixtures'
import { renderApp } from '@/test/router'

beforeEach(() => {
  initI18n('ko')
  // 인스턴스 시간대(Asia/Seoul) 2024-05-10 12:00.
  vi.useFakeTimers({
    shouldAdvanceTime: true,
    now: new Date('2024-05-10T03:00:00Z'),
  })
})

afterEach(() => {
  cleanup()
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

function renderHome(babies: Baby[], path = '/') {
  mockFetch({
    'GET /api/auth/me': () => json(200, { user: userFixture('family') }),
    'GET /api/settings': () => json(200, settingsFixture),
    'GET /api/babies': () => json(200, babies),
    'GET /api/users': () => json(200, { users: [] }),
    'GET /api/memories': () => json(200, null),
    'GET /api/days': () => json(200, { items: [], next_cursor: null }),
    [`GET /api/babies/${SEA.id}/stats`]: () =>
      json(200, {
        photo_count: 0,
        video_count: 0,
        day_count: 0,
        age_months: [],
      }),
    [`GET /api/babies/${SEA.id}/growth`]: () => json(200, []),
    [`GET /api/babies/${SEA.id}/milestones`]: () => json(200, []),
  })
  return renderApp(path)
}

// 셸 머리글. 아기 화면 링크는 아바타 + 이름.
async function header() {
  return within(await screen.findByRole('banner'))
}

describe('HomeHeader', () => {
  it('avatar_entry', async () => {
    // 1명: 아바타 + 이름 링크.
    renderHome([SKY])
    let banner = await header()
    const single = await banner.findByRole('link', { name: SKY.name })
    expect(single).toHaveAttribute('href', `/babies/${SKY.id}`)
    expect(single.querySelector('[aria-hidden]')).toHaveTextContent('하')
    expect(banner.getByText('D+101')).toBeInTheDocument()
    cleanup()

    // 2명 + 전체: 우리 집 이름, 아바타 링크 없음.
    const { user, router } = renderHome([SKY, SEA])
    banner = await header()
    const chips = within(
      await banner.findByRole('group', { name: ko.feed.babyFilter }),
    )
    expect(banner.getByText(settingsFixture.instance_name)).toBeInTheDocument()
    expect(banner.queryByRole('link', { name: SKY.name })).toBeNull()
    expect(banner.queryByRole('link', { name: SEA.name })).toBeNull()

    // 칩으로 1명 고르면 그 아이 아바타, 이름, D+.
    await user.click(chips.getByRole('button', { name: SEA.name }))
    const picked = await banner.findByRole('link', { name: SEA.name })
    expect(picked).toHaveAttribute('href', `/babies/${SEA.id}`)
    expect(banner.queryByText(settingsFixture.instance_name)).toBeNull()
    expect(banner.getByText('D+428')).toBeInTheDocument()

    await user.click(picked)
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/babies/${SEA.id}`)
    })
  })
})
