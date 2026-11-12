import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent, { PointerEventsCheckLevel } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssetSummary, Baby, Story, User } from '@/api/types'
import { initI18n } from '@/i18n'
import ko from '@/locales/ko.json'
import { json, mockFetch } from '@/test/fetch'
import {
  apiError,
  assetSummaryFixture,
  babyFixture,
  emptyFeedRoutes,
  settingsFixture,
  storyFixture,
  userFixture,
} from '@/test/fixtures'
import { renderApp } from '@/test/router'
import { storyKey } from './useStory'
import { uploadStore } from '@/upload/useUploadStore'
import { todayInZone } from '@/viewer/zoned'

const add =
  vi.fn<
    (
      files: File[],
      babyIds: string[],
      attach?: { kind: 'story' | 'milestone'; id: string },
    ) => string[]
  >()
const retry = vi.fn<(id: string) => void>()
vi.mock('@/upload/uploader', () => ({
  getUploader: () => ({ add, retry }),
}))

beforeEach(() => {
  initI18n('ko')
  add.mockReturnValue([])
})

afterEach(() => {
  cleanup()
  uploadStore.reset()
  localStorage.clear()
  add.mockReset()
  retry.mockReset()
  vi.restoreAllMocks()
})

type Routes = Parameters<typeof mockFetch>[0]

const ME = userFixture('guardian')
const GRANDMA: User = {
  ...userFixture('family'),
  id: '00000000-0000-4000-8000-000000000002',
  display_name: '할머니',
}
const SKY = babyFixture()
const SEA = babyFixture({
  id: '00000000-0000-4000-8000-0000000000b2',
  name: '바다',
})
const TODAY = todayInZone(settingsFixture.timezone)
const TOMORROW = new Date(Date.parse(`${TODAY}T00:00:00Z`) + 86_400_000)
  .toISOString()
  .slice(0, 10)

function setup(
  path: string,
  { babies = [SKY], extra = {} }: { babies?: Baby[]; extra?: Routes } = {},
) {
  mockFetch({
    ...emptyFeedRoutes,
    'GET /api/auth/me': () => json(200, { user: ME }),
    'GET /api/settings': () => json(200, settingsFixture),
    'GET /api/babies': () => json(200, babies),
    'GET /api/users': () => json(200, { users: [ME, GRANDMA] }),
    // 저장 뒤 도착하는 이야기 상세 화면.
    'GET /api/stories/s1': () => json(200, storyFixture('s1')),
    'GET /api/stories/s1/comments': () =>
      json(200, { items: [], next_cursor: null }),
    'GET /api/stories/s/comments': () =>
      json(200, { items: [], next_cursor: null }),
    ...extra,
  })
  return renderApp(path)
}

// POST 본문 기록. 응답은 id s1 이야기.
function createRoute(log: string[] = []) {
  const posts: unknown[] = []
  const route: Routes = {
    'POST /api/stories': async (req) => {
      posts.push(await req.json())
      log.push('post')
      return json(201, storyFixture('s1'))
    },
  }
  return { posts, route }
}

async function editor(title = ko.stories.newTitle) {
  await screen.findByRole('heading', { name: title })
  return {
    body: () => screen.getByRole('textbox', { name: ko.stories.body }),
    date: () => screen.getByLabelText<HTMLInputElement>(ko.stories.date),
    submit: () => screen.getByRole('button', { name: ko.stories.post }),
  }
}

// "새로 올리기" 로 기기 파일 고르기. 숨은 입력은 프로그램 click 이라 시트와 무관.
async function pickFile(
  app: ReturnType<typeof setup>,
  file: File,
): Promise<void> {
  const click = vi.spyOn(HTMLInputElement.prototype, 'click')
  await app.user.click(
    screen.getByRole('button', { name: ko.stories.uploadNew }),
  )
  const input = click.mock.contexts.at(-1)
  if (!(input instanceof HTMLInputElement)) throw new Error('파일 입력 없음')
  click.mockRestore()
  await userEvent
    .setup({ pointerEventsCheck: PointerEventsCheckLevel.Never })
    .upload(input, file)
}

function pathOf(app: ReturnType<typeof setup>) {
  return app.router.state.location.pathname
}

describe('StoryEditor', () => {
  it('create_text_only', async () => {
    const { posts, route } = createRoute()
    const app = setup('/stories/new', { babies: [SKY, SEA], extra: route })
    const ui = await editor()
    // 아기 둘 이상이면 기본 선택 없음.
    expect(screen.getByRole('button', { name: SKY.name })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    // 사진 없으면 띠 숨김.
    expect(
      screen.queryByRole('list', { name: ko.stories.photos }),
    ).not.toBeInTheDocument()
    expect(ui.submit()).toBeDisabled()

    // 멘션은 댓글과 같은 자동완성.
    await app.user.type(ui.body(), '오늘 @할')
    await app.user.click(screen.getByRole('option', { name: '할머니' }))
    await app.user.type(ui.body(), '랑 웃었어요')
    await app.user.click(ui.submit())

    await waitFor(() => {
      expect(pathOf(app)).toBe('/stories/s1')
    })
    expect(posts).toEqual([
      {
        entry_date: TODAY,
        body: `오늘 <@${GRANDMA.id}> 랑 웃었어요`,
        baby_ids: [],
        asset_ids: [],
      },
    ])
    expect(add).not.toHaveBeenCalled()
  })

  it('default_today_and_single_baby', async () => {
    const { posts, route } = createRoute()
    const app = setup('/stories/new', { extra: route })
    const ui = await editor()
    expect(ui.date()).toHaveValue(TODAY)
    expect(screen.getByRole('button', { name: SKY.name })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await app.user.type(ui.body(), '글')
    await app.user.click(ui.submit())
    await waitFor(() => {
      expect(posts).toHaveLength(1)
    })
    expect(posts[0]).toMatchObject({ entry_date: TODAY, baby_ids: [SKY.id] })

    // (+) 대신 그날 화면에서 오면 ?date= 가 기본값.
    cleanup()
    setup('/stories/new?date=2024-05-10')
    const other = await editor()
    expect(other.date()).toHaveValue('2024-05-10')
  })

  it('future_date_blocked', async () => {
    const app = setup(`/stories/new?date=${TOMORROW}`)
    const ui = await editor()
    // 미래 ?date= 는 오늘로.
    expect(ui.date()).toHaveValue(TODAY)
    expect(ui.date()).toHaveAttribute('max', TODAY)
    await app.user.type(ui.body(), '글')
    expect(ui.submit()).toBeEnabled()

    fireEvent.change(ui.date(), { target: { value: TOMORROW } })
    expect(
      await screen.findByText(ko.errors.story.dateInvalid),
    ).toBeInTheDocument()
    expect(ui.submit()).toBeDisabled()
  })

  it('server_error_copy', async () => {
    const app = setup('/stories/new', {
      extra: {
        'POST /api/stories': () => apiError(400, 'story.bodyInvalid'),
      },
    })
    const ui = await editor()
    await pickFile(app, new File(['x'], 'new.jpg', { type: 'image/jpeg' }))
    await app.user.type(ui.body(), '글')
    await app.user.click(ui.submit())
    expect(
      await screen.findByText(ko.errors.story.bodyInvalid),
    ).toBeInTheDocument()
    expect(pathOf(app)).toBe('/stories/new')
    // 저장 실패면 새 파일도 큐에 넣지 않음.
    expect(add).not.toHaveBeenCalled()
  })

  it('body_over_limit_warns', async () => {
    setup('/stories/new')
    const ui = await editor()
    fireEvent.change(ui.body(), { target: { value: '가'.repeat(5001) } })
    expect(await screen.findByText('5001/5000')).toBeInTheDocument()
    expect(ui.submit()).toBeDisabled()
  })

  it('pick_existing_photos', async () => {
    const d1 = assetSummaryFixture('d1')
    const d2 = assetSummaryFixture('d2')
    const o1 = assetSummaryFixture('o1', { local_date: '2024-05-01' })
    const dates: (string | null)[] = []
    const { posts, route } = createRoute()
    const app = setup('/stories/new?date=2024-05-10', {
      extra: {
        ...route,
        'GET /api/assets': (req) => {
          const date = new URL(req.url).searchParams.get('date')
          dates.push(date)
          return json(200, {
            items: date ? [d1, d2] : [d2, d1, o1],
            next_cursor: null,
          })
        },
      },
    })
    const ui = await editor()
    await app.user.click(
      screen.getByRole('button', { name: ko.stories.pickExisting }),
    )
    const sheet = await screen.findByRole('dialog', {
      name: ko.stories.pickTitle,
    })
    const tiles = async () => {
      const grid = await within(sheet).findByRole('group', {
        name: ko.stories.pickGrid,
      })
      return within(grid).getAllByRole('button')
    }

    // 그날 사진 먼저. 누른 순서대로.
    let shown = await tiles()
    expect(shown).toHaveLength(2)
    expect(dates).toEqual(['2024-05-10'])
    await app.user.click(shown[1] as HTMLElement)
    await app.user.click(shown[0] as HTMLElement)
    expect(shown[1]).toHaveAttribute('aria-pressed', 'true')

    // 다른 날: 전체 타임라인. 고른 상태 유지.
    await app.user.click(
      within(sheet).getByRole('button', { name: ko.stories.otherDays }),
    )
    await waitFor(async () => {
      expect(await tiles()).toHaveLength(3)
    })
    shown = await tiles()
    expect(shown.map((b) => b.getAttribute('aria-pressed'))).toEqual([
      'true',
      'true',
      'false',
    ])
    await app.user.click(shown[2] as HTMLElement)
    await app.user.click(
      within(sheet).getByRole('button', {
        name: ko.stories.pickDone_other.replace('{{count}}', '3'),
      }),
    )
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    const strip = screen.getByRole('list', { name: ko.stories.photos })
    expect(within(strip).getAllByRole('listitem')).toHaveLength(3)

    // 키보드로 순서 바꾸기: 첫 사진을 오른쪽으로.
    const first = within(strip).getAllByRole('listitem')[0] as HTMLElement
    act(() => {
      first.focus()
    })
    await app.user.keyboard('{ArrowRight}')

    await app.user.type(ui.body(), '사진 이야기')
    await app.user.click(ui.submit())
    await waitFor(() => {
      expect(posts).toHaveLength(1)
    })
    expect(posts[0]).toMatchObject({ asset_ids: ['d1', 'd2', 'o1'] })
  })

  it('new_photos_upload_with_attach', async () => {
    const log: string[] = []
    const { posts, route } = createRoute(log)
    add.mockImplementation(() => {
      log.push('add')
      return ['f1']
    })
    const app = setup('/stories/new', { extra: route })
    const ui = await editor()
    const file = new File(['x'], 'new.jpg', { type: 'image/jpeg' })
    await pickFile(app, file)

    // 미리보기만 띠에. 올리기 전엔 업로드 없음.
    const strip = await screen.findByRole('list', { name: ko.stories.photos })
    expect(within(strip).getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText(ko.stories.uploadHint)).toBeInTheDocument()
    expect(add).not.toHaveBeenCalled()

    await app.user.type(ui.body(), '새 사진')
    await app.user.click(ui.submit())
    await waitFor(() => {
      expect(add).toHaveBeenCalledWith([file], [SKY.id], {
        kind: 'story',
        id: 's1',
      })
    })
    expect(log).toEqual(['post', 'add'])
    expect(posts[0]).toMatchObject({ asset_ids: [] })
    await waitFor(() => {
      expect(pathOf(app)).toBe('/stories/s1')
    })
  })

  describe('edit', () => {
    const a1 = assetSummaryFixture('a1')
    const a2 = assetSummaryFixture('a2')
    const a9 = assetSummaryFixture('a9')

    function story(over: Partial<Story> = {}): Story {
      return storyFixture('s', {
        baby_ids: [SKY.id],
        assets: [a1, a2],
        previews: [a1, a2],
        asset_count: 2,
        ...over,
      })
    }

    function editRoutes(server: () => AssetSummary[], author = ME.id) {
      const patches: unknown[] = []
      const route: Routes = {
        'GET /api/stories/s': () =>
          json(200, story({ author_id: author, assets: server() })),
        'PATCH /api/stories/s': async (req) => {
          const body = (await req.json()) as unknown
          patches.push(body)
          return json(200, story())
        },
      }
      return { patches, route }
    }

    it('edit_replaces_assets', async () => {
      const { patches, route } = editRoutes(() => [a1, a2])
      const app = setup('/stories/s/edit', { extra: route })
      const ui = await editor(ko.stories.editTitle)
      expect(ui.body()).toHaveValue(storyFixture('s').body)
      expect(ui.date()).toHaveValue('2024-05-10')
      const strip = screen.getByRole('list', { name: ko.stories.photos })
      expect(within(strip).getAllByRole('listitem')).toHaveLength(2)

      await app.user.click(
        screen.getByRole('button', {
          name: ko.stories.removePhoto.replace('{{index}}', '1'),
        }),
      )
      await app.user.click(screen.getByRole('button', { name: ko.common.save }))
      await waitFor(() => {
        expect(pathOf(app)).toBe('/stories/s')
      })
      // 바꾼 필드만. 사진은 전체 교체.
      expect(patches).toEqual([{ asset_ids: ['a2'] }])
    })

    it('edit_keeps_server_added_assets', async () => {
      let server = [a1, a2]
      const { patches, route } = editRoutes(() => server)
      const app = setup('/stories/s/edit', { extra: route })
      await editor(ko.stories.editTitle)

      // 고치는 사이 백그라운드 업로드가 a9 를 붙임.
      server = [a1, a2, a9]
      await app.user.click(
        screen.getByRole('button', {
          name: ko.stories.removePhoto.replace('{{index}}', '2'),
        }),
      )
      await app.user.click(screen.getByRole('button', { name: ko.common.save }))
      await waitFor(() => {
        expect(patches).toHaveLength(1)
      })
      expect(patches[0]).toEqual({ asset_ids: ['a1', 'a9'] })
    })

    // 고치는 중 상세 재조회(창 포커스 등)가 비교 기준을 바꾸지 않음.
    async function refetchWith(
      app: ReturnType<typeof setup>,
      gets: { count: number },
    ) {
      const before = gets.count
      await act(() =>
        app.queryClient.invalidateQueries({ queryKey: storyKey('s') }),
      )
      await waitFor(() => {
        expect(gets.count).toBeGreaterThan(before)
      })
    }

    function countedRoutes(server: () => AssetSummary[]) {
      const gets = { count: 0 }
      const { patches, route } = editRoutes(server)
      const get = route['GET /api/stories/s']
      if (!get) throw new Error('GET 없음')
      route['GET /api/stories/s'] = (req) => {
        gets.count += 1
        return get(req)
      }
      return { gets, patches, route }
    }

    it('edit_ignores_refetch_baseline_body_only', async () => {
      let server = [a1, a2]
      const { gets, patches, route } = countedRoutes(() => server)
      const app = setup('/stories/s/edit', { extra: route })
      const ui = await editor(ko.stories.editTitle)

      server = [a1, a2, a9]
      await refetchWith(app, gets)
      await app.user.type(ui.body(), '!')
      await app.user.click(screen.getByRole('button', { name: ko.common.save }))
      await waitFor(() => {
        expect(patches).toHaveLength(1)
      })
      expect(patches[0]).toEqual({ body: `${storyFixture('s').body}!` })
    })

    it('edit_keeps_server_added_after_refetch', async () => {
      let server = [a1, a2]
      const { gets, patches, route } = countedRoutes(() => server)
      const app = setup('/stories/s/edit', { extra: route })
      await editor(ko.stories.editTitle)

      server = [a1, a2, a9]
      await refetchWith(app, gets)
      // 띠는 처음 목록 그대로.
      const strip = screen.getByRole('list', { name: ko.stories.photos })
      expect(within(strip).getAllByRole('listitem')).toHaveLength(2)
      await app.user.click(
        screen.getByRole('button', {
          name: ko.stories.removePhoto.replace('{{index}}', '2'),
        }),
      )
      await app.user.click(screen.getByRole('button', { name: ko.common.save }))
      await waitFor(() => {
        expect(patches).toHaveLength(1)
      })
      expect(patches[0]).toEqual({ asset_ids: ['a1', 'a9'] })
    })

    it('edit_new_files_attach_without_patch', async () => {
      // PATCH 미등록. 새 파일만 더하면 요청 없음.
      const route: Routes = {
        'GET /api/stories/s': () => json(200, story()),
      }
      const app = setup('/stories/s/edit', { extra: route })
      await editor(ko.stories.editTitle)
      const file = new File(['x'], 'new.jpg', { type: 'image/jpeg' })
      await pickFile(app, file)
      await app.user.click(screen.getByRole('button', { name: ko.common.save }))
      await waitFor(() => {
        expect(add).toHaveBeenCalledWith([file], [SKY.id], {
          kind: 'story',
          id: 's',
        })
      })
      await waitFor(() => {
        expect(pathOf(app)).toBe('/stories/s')
      })
    })

    it('strip_keyboard_reorder_keeps_focus', async () => {
      const a3 = assetSummaryFixture('a3')
      const { patches, route } = editRoutes(() => [a1, a2, a3])
      const app = setup('/stories/s/edit', { extra: route })
      await editor(ko.stories.editTitle)
      const strip = screen.getByRole('list', { name: ko.stories.photos })
      const items = () => within(strip).getAllByRole('listitem')
      const first = items()[0] as HTMLElement
      expect(first).toHaveAccessibleDescription(ko.stories.reorderHint)
      act(() => {
        first.focus()
      })
      await app.user.keyboard('{ArrowRight}')
      expect(first).toHaveFocus()
      await app.user.keyboard('{ArrowRight}')
      expect(first).toHaveFocus()
      expect(items()[2]).toBe(first)
      expect(
        screen.getByText(
          ko.stories.moved.replace('{{count}}', '3').replace('{{index}}', '3'),
        ),
      ).toBeInTheDocument()

      await app.user.click(screen.getByRole('button', { name: ko.common.save }))
      await waitFor(() => {
        expect(patches).toHaveLength(1)
      })
      expect(patches[0]).toEqual({ asset_ids: ['a2', 'a3', 'a1'] })
    })

    it('unchanged_edit_sends_nothing', async () => {
      // PATCH 미등록. 요청하면 테스트 실패.
      const route: Routes = {
        'GET /api/stories/s': () => json(200, story()),
      }
      const app = setup('/stories/s/edit', { extra: route })
      const ui = await editor(ko.stories.editTitle)
      // 고쳤다 되돌림. 같은 내용.
      await app.user.type(ui.body(), '!')
      await app.user.type(ui.body(), '{Backspace}')
      await app.user.click(screen.getByRole('button', { name: SKY.name }))
      await app.user.click(screen.getByRole('button', { name: SKY.name }))
      await app.user.click(screen.getByRole('button', { name: ko.common.save }))
      await waitFor(() => {
        expect(pathOf(app)).toBe('/stories/s')
      })
      // 내용 그대로면 나가기 확인도 없음.
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('edit_author_only', async () => {
      const { route } = editRoutes(
        () => [a1],
        '00000000-0000-4000-8000-000000000009',
      )
      const app = setup('/stories/s/edit', { extra: route })
      await waitFor(() => {
        expect(pathOf(app)).toBe('/stories/s')
      })
      expect(
        screen.queryByRole('heading', { name: ko.stories.editTitle }),
      ).not.toBeInTheDocument()
    })
  })

  it('leave_confirm', async () => {
    const app = setup('/stories/new')
    await editor()
    // 빈 화면은 확인 없이 나감.
    await app.user.click(screen.getByRole('button', { name: ko.common.cancel }))
    await waitFor(() => {
      expect(pathOf(app)).toBe('/')
    })

    await act(() => app.router.navigate({ to: '/stories/new' }))
    const ui = await editor()
    await app.user.type(ui.body(), '쓰다 만 이야기')
    await app.user.click(screen.getByRole('button', { name: ko.common.cancel }))
    const dialog = await screen.findByRole('dialog', {
      name: ko.stories.discardTitle,
    })
    await app.user.click(
      within(dialog).getByRole('button', { name: ko.stories.keepWriting }),
    )
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(pathOf(app)).toBe('/stories/new')
    expect(ui.body()).toHaveValue('쓰다 만 이야기')

    // 탭 이동도 같은 확인.
    await app.user.click(
      screen.getAllByRole('link', { name: ko.nav.home })[0] as HTMLElement,
    )
    const again = await screen.findByRole('dialog', {
      name: ko.stories.discardTitle,
    })
    await app.user.click(
      within(again).getByRole('button', { name: ko.stories.discard }),
    )
    await waitFor(() => {
      expect(pathOf(app)).toBe('/')
    })
  })
})
