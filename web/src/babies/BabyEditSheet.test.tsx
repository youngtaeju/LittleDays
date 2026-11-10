import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/errors'
import type { Baby, Role } from '@/api/types'
import { initI18n } from '@/i18n'
import { json, mockFetch } from '@/test/fetch'
import {
  apiError,
  assetFixture,
  assetSummaryFixture,
  babyFixture,
  settingsFixture,
  userFixture,
} from '@/test/fixtures'
import { renderApp } from '@/test/router'
import { uploadStore } from '@/upload/useUploadStore'
import { centerCrop, zoomCrop } from './crop'

const add = vi.fn<(files: File[], babyIds: string[]) => string[]>()
const retry = vi.fn<(id: string) => void>()
vi.mock('@/upload/uploader', () => ({
  getUploader: () => ({ add, retry }),
}))

beforeEach(() => {
  initI18n('ko')
})

afterEach(() => {
  cleanup()
  uploadStore.reset()
  localStorage.clear()
  add.mockReset()
  retry.mockReset()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const SKY = babyFixture()
const AVATAR = '00000000-0000-4000-8000-0000000000a1'
const PICKED = '00000000-0000-4000-8000-0000000000a2'
const CROP = { x: 0.1, y: 0, size: 0.5 }
// assetFixture 크기.
const W = 4032
const H = 3024

const EMPTY_STATS = {
  photo_count: 0,
  video_count: 0,
  day_count: 0,
  age_months: [],
}

// 첫째 아기 화면에서 시작. 아기 목록은 변경 가능(추가·삭제 후 재조회 반영).
function renderBabies(
  babies: Baby[],
  extra: Parameters<typeof mockFetch>[0] = {},
  role: Role = 'guardian',
) {
  const list = { current: babies }
  const puts: unknown[] = []
  mockFetch({
    'GET /api/auth/me': () => json(200, { user: userFixture(role) }),
    'GET /api/settings': () => json(200, settingsFixture),
    'GET /api/babies': () => json(200, list.current),
    ...Object.fromEntries(
      [...babies, babyFixture({ id: 'new' })].map((b) => [
        `GET /api/babies/${b.id}/stats`,
        () => json(200, EMPTY_STATS),
      ]),
    ),
    [`PUT /api/babies/${SKY.id}`]: async (req) => {
      puts.push(await req.json())
      return json(200, SKY)
    },
    ...extra,
  })
  const first = babies[0]
  const app = renderApp(first ? `/babies/${first.id}` : '/babies')
  return { ...app, list, puts }
}

type User = ReturnType<typeof renderBabies>['user']

async function menu(user: User) {
  await user.click(await screen.findByRole('button', { name: '아기 메뉴' }))
  return screen.findByRole('menu')
}

async function openEdit(user: User) {
  await user.click(
    within(await menu(user)).getByRole('menuitem', {
      name: '아기 정보 고치기',
    }),
  )
  return screen.findByRole('dialog', { name: '아기 정보 고치기' })
}

describe('BabyEditSheet', () => {
  it('menu_by_role', async () => {
    const { user } = renderBabies([SKY])
    const items = within(await menu(user)).getAllByRole('menuitem')
    expect(items.map((i) => i.textContent)).toEqual([
      '아기 정보 고치기',
      '아기 추가',
      '아기 삭제',
    ])
    cleanup()

    // 2명 이상이면 순서 바꾸기.
    const two = renderBabies([SKY, babyFixture({ id: 'b2', name: '바다' })])
    const items2 = within(await menu(two.user)).getAllByRole('menuitem')
    expect(items2.map((i) => i.textContent)).toEqual([
      '아기 정보 고치기',
      '아기 추가',
      '순서 바꾸기',
      '아기 삭제',
    ])
    cleanup()

    renderBabies([SKY], {}, 'family')
    expect(
      await screen.findByRole('heading', { level: 1, name: '하늘' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '아기 메뉴' })).toBeNull()
  })

  it('add_validation_error_then_goes_to_new_baby', async () => {
    const bodies: unknown[] = []
    let fail = true
    const { user, list, router } = renderBabies([SKY], {
      'POST /api/babies': async (req) => {
        bodies.push(await req.json())
        if (fail) return apiError(400, 'babies.nameInvalid')
        const created = babyFixture({ id: 'new', name: '구름' })
        list.current = [SKY, created]
        return json(201, created)
      },
    })
    await user.click(
      within(await menu(user)).getByRole('menuitem', { name: '아기 추가' }),
    )
    const sheet = await screen.findByRole('dialog', { name: '아기 추가' })
    // 새 아기는 사진이 없어 대표 사진 영역 없음.
    expect(within(sheet).queryByRole('group', { name: '대표 사진' })).toBeNull()
    await user.type(within(sheet).getByLabelText('이름'), '구름')
    await user.type(within(sheet).getByLabelText('생년월일'), '2025-01-01')
    await user.click(within(sheet).getByRole('button', { name: '저장하기' }))
    expect(
      await within(sheet).findByText('아기 이름이 올바르지 않아요.'),
    ).toBeInTheDocument()

    fail = false
    await user.click(within(sheet).getByRole('button', { name: '저장하기' }))
    expect(
      await screen.findByRole('heading', { level: 1, name: '구름' }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/babies/new')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(bodies).toEqual([
      { name: '구름', birth_date: '2025-01-01' },
      { name: '구름', birth_date: '2025-01-01' },
    ])
  })

  it('edit_keeps_avatar', async () => {
    const { user, puts } = renderBabies(
      [babyFixture({ avatar_asset_id: AVATAR, avatar_crop: CROP })],
      {
        [`GET /api/assets/${AVATAR}`]: () => json(200, assetFixture(AVATAR)),
      },
    )
    const sheet = await openEdit(user)
    const name = within(sheet).getByLabelText('이름')
    await user.clear(name)
    await user.type(name, '바다')
    await user.click(within(sheet).getByRole('button', { name: '저장하기' }))

    await waitFor(() => {
      expect(puts).toEqual([
        {
          name: '바다',
          birth_date: '2024-01-31',
          sex: null,
          avatar_asset_id: AVATAR,
          avatar_crop: CROP,
        },
      ])
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })

  it('pick_from_ours_sets_avatar', async () => {
    const queries: string[] = []
    const { user, puts } = renderBabies([SKY], {
      'GET /api/assets': (req) => {
        queries.push(new URL(req.url).search)
        return json(200, {
          items: [
            assetSummaryFixture('v1', { kind: 'video' }),
            assetSummaryFixture('p0', { status: 'processing' }),
            assetSummaryFixture(PICKED),
          ],
          next_cursor: null,
        })
      },
      [`GET /api/assets/${PICKED}`]: () => json(200, assetFixture(PICKED)),
    })
    const sheet = await openEdit(user)
    await user.click(
      within(sheet).getByRole('button', { name: '우리 사진에서 고르기' }),
    )
    // 처리 끝난 사진만.
    const grid = await within(sheet).findByRole('list', {
      name: '우리 사진에서 고르기',
    })
    // 하위 화면 전환 시 제목으로 포커스.
    expect(
      within(sheet).getByRole('heading', { name: '우리 사진에서 고르기' }),
    ).toHaveFocus()
    const choices = within(grid).getAllByRole('button')
    expect(choices).toHaveLength(1)
    expect(queries[0]).toContain(`baby_id=${SKY.id}`)
    await user.click(choices[0] as HTMLElement)

    // 기본 = 가운데 가장 큰 정사각.
    expect(
      await within(sheet).findByRole('group', { name: '사진 위치' }),
    ).toBeInTheDocument()
    expect(
      within(sheet).getByRole('heading', { name: '위치 맞추기' }),
    ).toHaveFocus()
    await user.click(
      within(sheet).getByRole('button', { name: '이 위치로 정하기' }),
    )
    // 폼으로 돌아와 새 대표 사진 표시. 연 버튼으로 포커스.
    const avatar = await within(sheet).findByRole('group', {
      name: '대표 사진',
    })
    expect(
      within(sheet).getByRole('button', { name: '우리 사진에서 고르기' }),
    ).toHaveFocus()
    await waitFor(() => {
      expect(avatar.querySelector('img')).toHaveAttribute(
        'src',
        `/api/assets/${PICKED}/preview.webp`,
      )
    })
    await user.click(within(sheet).getByRole('button', { name: '저장하기' }))
    await waitFor(() => {
      expect(puts).toEqual([
        {
          name: '하늘',
          birth_date: '2024-01-31',
          sex: null,
          avatar_asset_id: PICKED,
          avatar_crop: centerCrop(W, H),
        },
      ])
    })
  })

  it('crop_saved_with_put', async () => {
    const { user, puts } = renderBabies(
      [babyFixture({ avatar_asset_id: AVATAR, avatar_crop: CROP })],
      {
        [`GET /api/assets/${AVATAR}`]: () => json(200, assetFixture(AVATAR)),
      },
    )
    const sheet = await openEdit(user)
    await user.click(within(sheet).getByRole('button', { name: '위치 맞추기' }))
    // 저장된 위치에서 시작. 4배로.
    const zoom = await within(sheet).findByRole('slider', { name: '확대' })
    expect(zoom).toHaveValue('2')
    fireEvent.change(zoom, { target: { value: '4' } })
    await user.click(
      within(sheet).getByRole('button', { name: '이 위치로 정하기' }),
    )
    await user.click(
      await within(sheet).findByRole('button', { name: '저장하기' }),
    )
    await waitFor(() => {
      expect(puts).toEqual([
        {
          name: '하늘',
          birth_date: '2024-01-31',
          sex: null,
          avatar_asset_id: AVATAR,
          avatar_crop: zoomCrop(CROP, 4, W, H),
        },
      ])
    })
  })

  it('remove_avatar_clears_crop', async () => {
    const { user, puts } = renderBabies(
      [babyFixture({ avatar_asset_id: AVATAR, avatar_crop: CROP })],
      {
        [`GET /api/assets/${AVATAR}`]: () => json(200, assetFixture(AVATAR)),
      },
    )
    const sheet = await openEdit(user)
    await user.click(
      within(sheet).getByRole('button', { name: '대표 사진 빼기' }),
    )
    // 빼면 첫 글자 원.
    const avatar = within(sheet).getByRole('group', { name: '대표 사진' })
    expect(avatar.querySelector('img')).toBeNull()
    expect(
      within(sheet).queryByRole('button', { name: '위치 맞추기' }),
    ).toBeNull()
    await user.click(within(sheet).getByRole('button', { name: '저장하기' }))
    await waitFor(() => {
      expect(puts).toMatchObject([{ avatar_asset_id: null, avatar_crop: null }])
    })
  })

  it('upload_new_then_set', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let ready = false
    add.mockImplementation((files) => {
      uploadStore.put({
        id: 'up1',
        name: files[0]?.name ?? '',
        status: 'queued',
        progress: 0,
      })
      return ['up1']
    })
    const { user, puts } = renderBabies([SKY], {
      [`GET /api/assets/${PICKED}`]: () =>
        json(
          200,
          assetFixture(
            PICKED,
            ready
              ? {}
              : {
                  status: 'processing',
                  width: null,
                  height: null,
                  derivatives: {},
                },
          ),
        ),
    })
    const sheet = await openEdit(user)
    const input = sheet.querySelector<HTMLInputElement>('input[type=file]')
    if (!input) throw new Error('파일 입력 없음')
    const file = new File(['x'], 'new.jpg', { type: 'image/jpeg' })
    await user.upload(input, file)

    // 이 아기 태그로 일반 업로드. 올리는 동안 로컬 미리보기, 정하기 막힘.
    await waitFor(() => {
      expect(add).toHaveBeenCalledWith([file], [SKY.id])
    })
    expect(await within(sheet).findByText('올리는 중이에요')).toBeVisible()
    expect(sheet.querySelector('img[src="blob:test"]')).not.toBeNull()
    const useCrop = within(sheet).getByRole('button', {
      name: '이 위치로 정하기',
    })
    expect(useCrop).toBeDisabled()

    // 업로드 완료 → 처리 중이면 계속 미리보기.
    act(() => {
      uploadStore.patch('up1', { status: 'done', assetId: PICKED })
    })
    expect(await within(sheet).findByText(/^처리 중이에요/)).toBeInTheDocument()
    expect(sheet.querySelector('img[src="blob:test"]')).not.toBeNull()
    expect(
      within(sheet).getByRole('button', { name: '이 위치로 정하기' }),
    ).toBeDisabled()

    // 처리 끝 → 자르기.
    ready = true
    await act(() => vi.advanceTimersByTimeAsync(3000))
    expect(
      await within(sheet).findByRole('group', { name: '사진 위치' }),
    ).toBeInTheDocument()
    await user.click(
      within(sheet).getByRole('button', { name: '이 위치로 정하기' }),
    )
    await user.click(
      await within(sheet).findByRole('button', { name: '저장하기' }),
    )
    await waitFor(() => {
      expect(puts).toMatchObject([
        { avatar_asset_id: PICKED, avatar_crop: centerCrop(W, H) },
      ])
    })
  })

  // 이미 있던 사진(중복)은 이 아기 태그가 없을 수 있음. 정하기 전에 태그 추가.
  it('duplicate_upload_adds_baby_tag', async () => {
    const OTHER = '00000000-0000-4000-8000-0000000000b9'
    let tagged = [OTHER]
    const tagBodies: unknown[] = []
    add.mockImplementation(() => {
      uploadStore.put({
        id: 'up1',
        name: 'old.jpg',
        status: 'duplicate',
        progress: 0,
        assetId: PICKED,
        inTrash: false,
      })
      return ['up1']
    })
    const { user, puts } = renderBabies([SKY], {
      [`GET /api/assets/${PICKED}`]: () =>
        json(200, assetFixture(PICKED, { baby_ids: tagged })),
      [`PUT /api/assets/${PICKED}/babies`]: async (req) => {
        const body = (await req.json()) as { baby_ids: string[] }
        tagBodies.push(body)
        tagged = body.baby_ids
        return json(200, assetFixture(PICKED, { baby_ids: tagged }))
      },
    })
    const sheet = await openEdit(user)
    const input = sheet.querySelector<HTMLInputElement>('input[type=file]')
    if (!input) throw new Error('파일 입력 없음')
    await user.upload(input, new File(['x'], 'old.jpg', { type: 'image/jpeg' }))
    await within(sheet).findByRole('group', { name: '사진 위치' })
    await user.click(
      within(sheet).getByRole('button', { name: '이 위치로 정하기' }),
    )
    await user.click(
      await within(sheet).findByRole('button', { name: '저장하기' }),
    )
    await waitFor(() => {
      expect(puts).toMatchObject([{ avatar_asset_id: PICKED }])
    })
    expect(tagBodies).toEqual([{ baby_ids: [OTHER, SKY.id] }])
  })

  // 이미 태그돼 있으면 태그 요청 없음.
  it('duplicate_upload_already_tagged_skips_tag', async () => {
    add.mockImplementation(() => {
      uploadStore.put({
        id: 'up1',
        name: 'old.jpg',
        status: 'duplicate',
        progress: 0,
        assetId: PICKED,
        inTrash: false,
      })
      return ['up1']
    })
    const { user, puts } = renderBabies([SKY], {
      [`GET /api/assets/${PICKED}`]: () =>
        json(200, assetFixture(PICKED, { baby_ids: [SKY.id] })),
    })
    const sheet = await openEdit(user)
    const input = sheet.querySelector<HTMLInputElement>('input[type=file]')
    if (!input) throw new Error('파일 입력 없음')
    await user.click(
      within(sheet).getByRole('button', { name: '기기에서 올리기' }),
    )
    await user.upload(input, new File(['x'], 'old.jpg', { type: 'image/jpeg' }))
    await within(sheet).findByRole('group', { name: '사진 위치' })
    await user.click(
      within(sheet).getByRole('button', { name: '이 위치로 정하기' }),
    )
    // 폼으로 돌아오면 연 버튼으로 포커스.
    expect(
      await within(sheet).findByRole('button', { name: '기기에서 올리기' }),
    ).toHaveFocus()
    await user.click(within(sheet).getByRole('button', { name: '저장하기' }))
    await waitFor(() => {
      expect(puts).toMatchObject([{ avatar_asset_id: PICKED }])
    })
  })

  it('upload_error_lets_retry_or_choose_again', async () => {
    add.mockImplementation(() => {
      uploadStore.put({
        id: 'up1',
        name: 'new.jpg',
        status: 'error',
        progress: 0,
        error: new ApiError(413, 'upload.tooLarge', {}),
      })
      return ['up1']
    })
    const { user } = renderBabies([SKY])
    const sheet = await openEdit(user)
    const input = sheet.querySelector<HTMLInputElement>('input[type=file]')
    if (!input) throw new Error('파일 입력 없음')
    await user.upload(input, new File(['x'], 'new.jpg', { type: 'image/jpeg' }))
    expect(await within(sheet).findByRole('alert')).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: '다시 시도' }))
    await waitFor(() => {
      expect(retry).toHaveBeenCalledWith('up1')
    })
    expect(
      within(sheet).getByRole('button', { name: '다른 사진 고르기' }),
    ).toBeInTheDocument()

    // accept 무시하는 기기에서 고른 영상은 올리지 않음.
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'v.mp4', { type: 'video/mp4' })] },
    })
    expect(
      await within(sheet).findByText('사진만 대표 사진으로 쓸 수 있어요.'),
    ).toBeInTheDocument()
    expect(add).toHaveBeenCalledTimes(1)
  })

  it('reorder_sends_full_order', async () => {
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
      within(await menu(user)).getByRole('menuitem', { name: '순서 바꾸기' }),
    )
    const sheet = await screen.findByRole('dialog', { name: '순서 바꾸기' })
    expect(
      within(sheet).getByRole('button', { name: '가 위로' }),
    ).toBeDisabled()
    await user.click(within(sheet).getByRole('button', { name: '가 아래로' }))
    await waitFor(() => {
      expect(bodies).toEqual([{ ids: ['b', 'a', 'c'] }])
    })
  })

  it('delete_confirms_then_goes_to_babies', async () => {
    let deleted = false
    const SEA = babyFixture({ id: 'b2', name: '바다' })
    const { user, list, router } = renderBabies([SKY, SEA], {
      [`DELETE /api/babies/${SKY.id}`]: () => {
        deleted = true
        list.current = [SEA]
        return json(204, null)
      },
    })
    await user.click(
      within(await menu(user)).getByRole('menuitem', { name: '아기 삭제' }),
    )
    const dialog = await screen.findByRole('dialog', {
      name: "'하늘' 아기를 삭제할까요?",
    })
    expect(within(dialog).getByText(/태그도 함께 지워져요/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '삭제하기' }))
    expect(
      await screen.findByRole('heading', { level: 1, name: '바다' }),
    ).toBeInTheDocument()
    expect(deleted).toBe(true)
    expect(router.state.location.pathname).toBe('/babies/b2')
  })
})
