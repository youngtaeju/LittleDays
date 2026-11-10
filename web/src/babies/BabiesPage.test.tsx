import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Baby, Role } from '@/api/types'
import { initI18n } from '@/i18n'
import { json, mockFetch } from '@/test/fetch'
import {
  apiError,
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

function renderBabies(
  babies: Baby[],
  extra: Parameters<typeof mockFetch>[0] = {},
  role: Role = 'guardian',
) {
  mockFetch({
    'GET /api/auth/me': () => json(200, { user: userFixture(role) }),
    'GET /api/settings': () => json(200, settingsFixture),
    'GET /api/babies': () => json(200, babies),
    ...extra,
  })
  return renderApp('/babies')
}

describe('BabiesPage', () => {
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

  it('lists_age_and_initial', async () => {
    renderBabies([
      babyFixture({ id: 'x1', name: '하늘', birth_date: '2024-01-31' }),
    ])
    expect(await screen.findByText('하늘')).toBeInTheDocument()
    expect(screen.getByText('2024-01-31')).toBeInTheDocument()
    expect(screen.getByText('살', { exact: false })).toBeInTheDocument()
  })

  it('edit_keeps_avatar', async () => {
    const bodies: unknown[] = []
    const { user } = renderBabies(
      [babyFixture({ avatar_asset_id: AVATAR, avatar_crop: CROP })],
      {
        'PUT /api/babies/00000000-0000-4000-8000-0000000000b1': async (req) => {
          bodies.push(await req.json())
          return json(200, babyFixture())
        },
      },
    )
    await user.click(await screen.findByRole('button', { name: '하늘 수정' }))
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
    await user.click(await screen.findByRole('button', { name: '하늘 수정' }))
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
    await user.click(await screen.findByRole('button', { name: '가 아래로' }))
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
    await user.click(await screen.findByRole('button', { name: '하늘 삭제' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/태그도 함께 지워져요/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '삭제' }))
    await waitFor(() => {
      expect(deleted).toBe(true)
    })
  })

  it('empty_state_by_role', async () => {
    const { user } = renderBabies([], {
      'POST /api/babies': () => apiError(400, 'babies.nameInvalid'),
    })
    expect(await screen.findByText('아기를 추가해 보세요')).toBeInTheDocument()
    const buttons = screen.getAllByRole('button', { name: '아기 추가' })
    expect(buttons).toHaveLength(2)
    await user.click(buttons[1] as HTMLElement)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    cleanup()

    renderBabies([], {}, 'family')
    expect(
      await screen.findByText('아직 등록한 아기가 없어요.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '아기 추가' })).toBeNull()
  })

  it('family_read_only', async () => {
    renderBabies([babyFixture()], {}, 'family')
    expect(await screen.findByText('하늘')).toBeInTheDocument()
    for (const name of [
      '아기 추가',
      '하늘 수정',
      '하늘 삭제',
      '하늘 위로',
      '하늘 아래로',
    ]) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
  })
})
