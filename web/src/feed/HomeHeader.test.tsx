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

function renderHome(
  babies: Baby[],
  primary: string | null = null,
  settings: () => Response | Promise<Response> = () =>
    json(200, { ...settingsFixture, primary_baby_id: primary }),
) {
  mockFetch({
    'GET /api/auth/me': () => json(200, { user: userFixture('family') }),
    'GET /api/settings': settings,
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
  return renderApp('/')
}

// 셸 머리글.
async function header() {
  return within(await screen.findByRole('banner'))
}

describe('HomeHeader', () => {
  it('title_is_instance_name', async () => {
    // 아이 1명이어도 제목은 우리 집 이름. 아기는 알약.
    renderHome([SKY])
    const banner = await header()
    expect(
      await banner.findByRole('link', { name: SKY.name }),
    ).toBeInTheDocument()
    expect(banner.getByText(settingsFixture.instance_name)).toBeInTheDocument()
    expect(banner.queryByRole('group')).toBeNull()
  })

  it('pill_primary_on_all', async () => {
    // 전체: 대표 아기(둘째로 설정).
    renderHome([SKY, SEA], SEA.id)
    const banner = await header()
    const chips = within(
      await banner.findByRole('group', { name: ko.feed.babyFilter }),
    )
    expect(chips.getByRole('button', { name: ko.feed.all })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    const pill = await banner.findByRole('link', { name: SEA.name })
    expect(within(pill).getByText('D+428')).toBeInTheDocument()
    expect(pill.querySelector('[aria-hidden]')).toHaveTextContent('바')
    expect(banner.queryByRole('link', { name: SKY.name })).toBeNull()
    expect(banner.getByText(settingsFixture.instance_name)).toBeInTheDocument()
  })

  it('pill_follows_chip', async () => {
    const { user } = renderHome([SKY, SEA], SEA.id)
    const banner = await header()
    const chips = within(
      await banner.findByRole('group', { name: ko.feed.babyFilter }),
    )
    await banner.findByRole('link', { name: SEA.name })

    // 칩으로 1명 고르면 그 아이.
    await user.click(chips.getByRole('button', { name: SKY.name }))
    const picked = await banner.findByRole('link', { name: SKY.name })
    expect(within(picked).getByText('D+101')).toBeInTheDocument()
    expect(banner.queryByRole('link', { name: SEA.name })).toBeNull()
    expect(banner.getByText(settingsFixture.instance_name)).toBeInTheDocument()

    // 전체로 돌아가면 대표 아기.
    await user.click(chips.getByRole('button', { name: ko.feed.all }))
    expect(
      await banner.findByRole('link', { name: SEA.name }),
    ).toBeInTheDocument()
  })

  it('pill_links_baby', async () => {
    const { user, router } = renderHome([SKY, SEA], SEA.id)
    const banner = await header()
    const pill = await banner.findByRole('link', { name: SEA.name })
    expect(pill).toHaveAttribute('href', `/babies/${SEA.id}`)
    // 배지는 설명으로 읽힘.
    expect(pill).toHaveAccessibleDescription('D+428')

    await user.click(pill)
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/babies/${SEA.id}`)
    })
  })

  it('pill_waits_for_settings', async () => {
    // 설정 조회 중: 알약 없음(첫째로 먼저 그리지 않음). 응답 뒤 대표 아기.
    let resolve: ((r: Response) => void) | undefined
    renderHome(
      [SKY, SEA],
      SEA.id,
      () =>
        new Promise<Response>((r) => {
          resolve = r
        }),
    )
    const banner = await header()
    await banner.findByRole('group', { name: ko.feed.babyFilter })
    await waitFor(() => {
      expect(resolve).toBeDefined()
    })
    expect(banner.queryByRole('link')).toBeNull()
    expect(banner.queryByText(/^D[+-]/)).toBeNull()

    resolve?.(json(200, { ...settingsFixture, primary_baby_id: SEA.id }))
    expect(
      await banner.findByRole('link', { name: SEA.name }),
    ).toBeInTheDocument()
    expect(banner.queryByRole('link', { name: SKY.name })).toBeNull()
  })

  it('header_due_baby', async () => {
    const due = babyFixture({ birth_date: '2024-06-01' })
    renderHome([due])
    const banner = await header()
    const pill = await banner.findByRole('link', { name: due.name })
    expect(within(pill).getByText('D-22')).toBeInTheDocument()
    expect(banner.queryByText(/^D\+/)).toBeNull()
  })

  it('no_babies_header', async () => {
    const { queryClient } = renderHome([])
    const banner = await header()
    expect(
      await banner.findByText(settingsFixture.instance_name),
    ).toBeInTheDocument()
    // 아기 목록 조회 끝난 뒤에도 알약 없음.
    await waitFor(() => {
      expect(queryClient.getQueryData(['babies'])).toEqual([])
    })
    expect(banner.queryByRole('link')).toBeNull()
    expect(banner.queryByText(/^D[+-]/)).toBeNull()
    expect(banner.queryByRole('group')).toBeNull()
  })
})
