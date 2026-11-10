import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Baby, Role } from '@/api/types'
import { initI18n } from '@/i18n'
import { json, mockFetch } from '@/test/fetch'
import {
  apiError,
  assetFixture,
  babyFixture,
  settingsFixture,
  userFixture,
} from '@/test/fixtures'
import { renderApp } from '@/test/router'

beforeEach(() => {
  initI18n('ko')
})

afterEach(cleanup)

const CROP = { x: 0.1, y: 0, size: 0.5 }
const AVATAR = '00000000-0000-4000-8000-0000000000a1'

const EMPTY_STATS = {
  photo_count: 0,
  video_count: 0,
  day_count: 0,
  age_months: [],
}

// 첫째 아기 화면에서 시작.
function renderBabies(
  babies: Baby[],
  extra: Parameters<typeof mockFetch>[0] = {},
  role: Role = 'guardian',
) {
  mockFetch({
    'GET /api/auth/me': () => json(200, { user: userFixture(role) }),
    'GET /api/settings': () => json(200, settingsFixture),
    'GET /api/babies': () => json(200, babies),
    ...Object.fromEntries(
      babies.map((b) => [
        `GET /api/babies/${b.id}/stats`,
        () => json(200, EMPTY_STATS),
      ]),
    ),
    ...extra,
  })
  return renderApp('/babies')
}

// ⋮ → 아기 관리 대화상자.
async function openManager(user: ReturnType<typeof renderBabies>['user']) {
  await user.click(await screen.findByRole('button', { name: '아기 관리' }))
  return screen.findByRole('dialog', { name: '아기 관리' })
}

describe('BabyManager', () => {
  it('create_and_validation_error', async () => {
    const bodies: unknown[] = []
    const { user } = renderBabies([], {
      'POST /api/babies': async (req) => {
        bodies.push(await req.json())
        return apiError(400, 'babies.nameInvalid')
      },
    })
    await user.click(await screen.findByRole('button', { name: '아기 추가' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('이름'), '하늘')
    await user.type(within(dialog).getByLabelText('생년월일'), '2024-01-31')
    await user.click(within(dialog).getByRole('button', { name: '저장' }))

    expect(
      await within(dialog).findByText('아기 이름이 올바르지 않아요.'),
    ).toBeInTheDocument()
    expect(bodies).toEqual([{ name: '하늘', birth_date: '2024-01-31' }])
  })

  it('lists_babies_and_adds', async () => {
    const bodies: unknown[] = []
    const { user } = renderBabies(
      [babyFixture(), babyFixture({ id: 'b2', name: '바다' })],
      {
        'POST /api/babies': async (req) => {
          bodies.push(await req.json())
          return json(201, babyFixture({ id: 'b3', name: '구름' }))
        },
      },
    )
    const dialog = await openManager(user)
    expect(
      within(dialog)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['하하늘', '바바다'])
    await user.click(within(dialog).getByRole('button', { name: '아기 추가' }))
    const form = await screen.findByRole('dialog', { name: '아기 추가' })
    await user.type(within(form).getByLabelText('이름'), '구름')
    await user.type(within(form).getByLabelText('생년월일'), '2025-01-01')
    await user.click(within(form).getByRole('button', { name: '저장' }))
    // 저장 후 목록으로.
    expect(
      await screen.findByRole('dialog', { name: '아기 관리' }),
    ).toBeInTheDocument()
    expect(bodies).toEqual([{ name: '구름', birth_date: '2025-01-01' }])
  })

  it('edit_keeps_avatar', async () => {
    const bodies: unknown[] = []
    const { user } = renderBabies(
      [babyFixture({ avatar_asset_id: AVATAR, avatar_crop: CROP })],
      {
        [`GET /api/assets/${AVATAR}`]: () => json(200, assetFixture(AVATAR)),
        'PUT /api/babies/00000000-0000-4000-8000-0000000000b1': async (req) => {
          bodies.push(await req.json())
          return json(200, babyFixture())
        },
      },
    )
    await user.click(
      within(await openManager(user)).getByRole('button', {
        name: '하늘 수정',
      }),
    )
    const dialog = await screen.findByRole('dialog')
    const name = within(dialog).getByLabelText('이름')
    await user.clear(name)
    await user.type(name, '바다')
    await user.click(within(dialog).getByRole('button', { name: '저장' }))

    await waitFor(() => {
      expect(bodies).toEqual([
        {
          name: '바다',
          birth_date: '2024-01-31',
          sex: null,
          avatar_asset_id: AVATAR,
          avatar_crop: CROP,
        },
      ])
    })
  })

  it('clear_avatar', async () => {
    const bodies: unknown[] = []
    const { user } = renderBabies([babyFixture({ avatar_asset_id: AVATAR })], {
      'PUT /api/babies/00000000-0000-4000-8000-0000000000b1': async (req) => {
        bodies.push(await req.json())
        return json(200, babyFixture())
      },
    })
    await user.click(
      within(await openManager(user)).getByRole('button', {
        name: '하늘 수정',
      }),
    )
    const dialog = await screen.findByRole('dialog')
    await user.click(
      within(dialog).getByRole('checkbox', { name: '대표 사진 지우기' }),
    )
    await user.click(within(dialog).getByRole('button', { name: '저장' }))

    await waitFor(() => {
      expect(bodies).toMatchObject([{ avatar_asset_id: null }])
    })
  })

  it('move_down_sends_full_order', async () => {
    const bodies: unknown[] = []
    const { user } = renderBabies(
      [
        babyFixture({ id: 'a', name: '가' }),
        babyFixture({ id: 'b', name: '나' }),
        babyFixture({ id: 'c', name: '다' }),
      ],
      {
        'PUT /api/babies/order': async (req) => {
          bodies.push(await req.json())
          return json(204, null)
        },
      },
    )
    await user.click(
      within(await openManager(user)).getByRole('button', {
        name: '가 아래로',
      }),
    )
    await waitFor(() => {
      expect(bodies).toEqual([{ ids: ['b', 'a', 'c'] }])
    })
  })

  it('delete_confirms_tag_removal', async () => {
    let deleted = false
    const { user } = renderBabies([babyFixture()], {
      'DELETE /api/babies/00000000-0000-4000-8000-0000000000b1': () => {
        deleted = true
        return json(204, null)
      },
    })
    await user.click(
      within(await openManager(user)).getByRole('button', {
        name: '하늘 삭제',
      }),
    )
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/태그도 함께 지워져요/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '삭제' }))
    await waitFor(() => {
      expect(deleted).toBe(true)
    })
  })

  it('family_read_only', async () => {
    renderBabies([babyFixture()], {}, 'family')
    expect(
      await screen.findByRole('heading', { level: 1, name: '하늘' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '아기 관리' })).toBeNull()
  })
})
