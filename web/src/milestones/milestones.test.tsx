import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent, { PointerEventsCheckLevel } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Baby, Milestone, Role } from '@/api/types'
import { initI18n } from '@/i18n'
import ko from '@/locales/ko.json'
import { json, mockFetch } from '@/test/fetch'
import {
  apiError,
  assetSummaryFixture,
  babyFixture,
  milestoneFixture,
  settingsFixture,
  userFixture,
} from '@/test/fixtures'
import { renderApp } from '@/test/router'
import { uploadStore } from '@/upload/useUploadStore'
import { MILESTONE_PRESETS } from './presets'
import { milestoneKey } from './useMilestones'

const add =
  vi.fn<
    (
      files: File[],
      babyIds: string[],
      attach?: { kind: 'story' | 'milestone'; id: string },
    ) => string[]
  >()
vi.mock('@/upload/uploader', () => ({
  getUploader: () => ({ add, retry: vi.fn() }),
}))

beforeEach(() => {
  initI18n('ko')
  add.mockReturnValue([])
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
  uploadStore.reset()
  localStorage.clear()
  add.mockReset()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

type Routes = Parameters<typeof mockFetch>[0]

const SKY = babyFixture({ birth_date: '2025-09-26', sex: 'male' })
const A1 = assetSummaryFixture('a1', { local_date: '2026-11-01' })

// 서버 정렬(달성일 오름차순).
const MILESTONES: Milestone[] = [
  milestoneFixture('m3', {
    baby_id: SKY.id,
    preset_key: 'first_smile',
    achieved_on: '2025-11-20',
  }),
  milestoneFixture('m2', {
    baby_id: SKY.id,
    preset_key: null,
    custom_label: '첫 수영',
    achieved_on: '2026-08-15',
    note: '바닷가',
  }),
  milestoneFixture('m1', {
    baby_id: SKY.id,
    preset_key: 'walk_alone',
    achieved_on: '2026-11-01',
    previews: [A1],
    asset_count: 1,
    assets: [A1],
  }),
]

const EMPTY_STATS = {
  photo_count: 0,
  video_count: 0,
  day_count: 0,
  age_months: [],
}

function setup(
  path: string,
  opts: {
    role?: Role
    babies?: Baby[]
    milestones?: Milestone[]
    extra?: Routes
  } = {},
) {
  const babies = opts.babies ?? [SKY]
  const list = opts.milestones ?? MILESTONES
  const listGets: string[] = []
  mockFetch({
    'GET /api/auth/me': () =>
      json(200, { user: userFixture(opts.role ?? 'guardian') }),
    'GET /api/settings': () => json(200, settingsFixture),
    'GET /api/babies': () => json(200, babies),
    'GET /api/users': () => json(200, { users: [userFixture('guardian')] }),
    'GET /api/days': () => json(200, { items: [], next_cursor: null }),
    ...Object.fromEntries(
      babies.flatMap((b) => [
        [`GET /api/babies/${b.id}/stats`, () => json(200, EMPTY_STATS)],
        [`GET /api/babies/${b.id}/growth`, () => json(200, [])],
        [
          `GET /api/babies/${b.id}/milestones`,
          () => {
            listGets.push(b.id)
            return json(
              200,
              list.filter((m) => m.baby_id === b.id),
            )
          },
        ],
      ]),
    ),
    ...Object.fromEntries(
      list.map((m) => [`GET /api/milestones/${m.id}`, () => json(200, m)]),
    ),
    ...opts.extra,
  })
  return { ...renderApp(path), listGets }
}

async function section() {
  return screen.findByRole('region', { name: ko.milestones.title })
}

async function openPicker(user: ReturnType<typeof setup>['user']) {
  const s = await section()
  await user.click(
    await within(s).findByRole('button', { name: ko.milestones.addLabel }),
  )
  return screen.findByRole('dialog', { name: ko.milestones.pickerTitle })
}

function presetName(key: string): string {
  return (ko.milestones.presets as Record<string, string>)[key] ?? key
}

// "새로 올리기" 로 기기 파일 고르기. 숨은 입력은 프로그램 click.
async function pickFile(
  user: ReturnType<typeof setup>['user'],
  sheet: HTMLElement,
  file: File,
): Promise<void> {
  const click = vi.spyOn(HTMLInputElement.prototype, 'click')
  await user.click(
    within(sheet).getByRole('button', { name: ko.stories.uploadNew }),
  )
  const input = click.mock.contexts.at(-1)
  if (!(input instanceof HTMLInputElement)) throw new Error('파일 입력 없음')
  click.mockRestore()
  await userEvent
    .setup({ pointerEventsCheck: PointerEventsCheckLevel.Never })
    .upload(input, file)
}

describe('milestones', () => {
  it('presets_match_spec', () => {
    // 스펙 §8 표. 무리, 범위 출처.
    expect(MILESTONE_PRESETS.map((p) => p.key)).toEqual([
      'first_smile',
      'neck_control',
      'rollover',
      'sit_alone',
      'crawl',
      'stand_holding',
      'walk_holding',
      'stand_alone',
      'walk_alone',
      'run',
      'stairs',
      'first_word',
      'two_words',
      'wave_bye',
      'clap',
      'point',
      'spoon_self',
      'first_tooth',
      'first_solid_food',
      'sleep_through',
      'potty',
      'first_haircut',
      'first_trip',
      'first_daycare',
    ])
    const byKey = Object.fromEntries(MILESTONE_PRESETS.map((p) => [p.key, p]))
    expect(byKey.sit_alone).toEqual({
      key: 'sit_alone',
      group: 'motion',
      range: { from: 4, to: 9, source: 'who' },
    })
    expect(byKey.walk_alone?.range).toEqual({ from: 8, to: 18, source: 'who' })
    expect(byKey.first_smile).toEqual({
      key: 'first_smile',
      group: 'social',
      range: { by: 2, source: 'cdc' },
    })
    expect(byKey.spoon_self?.range).toEqual({ by: 18, source: 'cdc' })
    expect(byKey.first_tooth).toEqual({
      key: 'first_tooth',
      group: 'life',
      range: null,
    })
    for (const p of MILESTONE_PRESETS) {
      expect(presetName(p.key)).not.toBe(p.key)
    }
  })

  it('picker_groups_and_ranges', async () => {
    const { user } = setup(`/babies/${SKY.id}`, { milestones: [] })
    const sheet = await openPicker(user)
    const groups = await within(sheet).findAllByRole('group')
    expect(groups).toHaveLength(3)
    const [motion, social, life] = groups
    if (!motion || !social || !life) throw new Error('무리 없음')
    expect(motion).toHaveAccessibleName(ko.milestones.groups.motion)
    expect(social).toHaveAccessibleName(ko.milestones.groups.social)
    expect(life).toHaveAccessibleName(ko.milestones.groups.life)
    expect(within(motion).getAllByRole('button')).toHaveLength(10)
    expect(within(social).getAllByRole('button')).toHaveLength(6)
    expect(within(life).getAllByRole('button')).toHaveLength(8)

    // WHO 범위, CDC 기준, 범위 없음.
    expect(
      within(motion).getByRole('button', { name: /^혼자 걷기/ }),
    ).toHaveTextContent('혼자 걷기보통 8~18개월')
    expect(
      within(social).getByRole('button', { name: /^첫 웃음/ }),
    ).toHaveTextContent('첫 웃음대부분 2개월까지')
    expect(
      within(life).getByRole('button', { name: /^첫 이$/ }),
    ).toHaveTextContent(/^첫 이$/)
    expect(
      within(sheet).getByRole('button', { name: ko.milestones.custom }),
    ).toBeInTheDocument()
  })

  it('recorded_preset_dimmed', async () => {
    const { user, router } = setup(`/babies/${SKY.id}`)
    const sheet = await openPicker(user)
    const walk = await within(sheet).findByRole('button', {
      name: /^혼자 걷기/,
    })
    await waitFor(() => {
      expect(walk).toHaveTextContent('혼자 걷기11월 1일 기록함')
    })
    expect(walk).toHaveAttribute('data-recorded')
    expect(within(walk).getByText('혼자 걷기')).toHaveClass(
      'text-muted-foreground',
    )
    const stand = within(sheet).getByRole('button', { name: /^혼자 서기/ })
    expect(stand).not.toHaveAttribute('data-recorded')
    // 직접 입력 항목은 목록에 영향 없음.
    expect(
      within(sheet).getByRole('button', { name: /^첫 웃음/ }),
    ).toHaveTextContent('2025년 11월 20일 기록함')

    // 기록한 항목을 누르면 그 상세.
    await user.click(walk)
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/milestones/m1')
    })
    expect(sheet).not.toBeInTheDocument()
  })

  it('custom_label_rules', async () => {
    const posts: unknown[] = []
    let fail = false
    const { user, listGets } = setup(`/babies/${SKY.id}`, {
      milestones: [],
      extra: {
        [`POST /api/babies/${SKY.id}/milestones`]: async (req) => {
          posts.push(await req.json())
          if (fail) return apiError(400, 'milestone.labelInvalid')
          return json(
            201,
            milestoneFixture('m9', {
              baby_id: SKY.id,
              preset_key: null,
              custom_label: '첫 수영',
              achieved_on: '2026-11-10',
            }),
          )
        },
      },
    })
    const picker = await openPicker(user)
    await user.click(
      within(picker).getByRole('button', { name: ko.milestones.custom }),
    )
    const sheet = await screen.findByRole('dialog', {
      name: ko.milestones.customTitle,
    })
    const ui = {
      name: within(sheet).getByLabelText<HTMLInputElement>(ko.milestones.name),
      date: within(sheet).getByLabelText<HTMLInputElement>(ko.milestones.date),
      note: within(sheet).getByLabelText<HTMLInputElement>(ko.milestones.note),
      save: within(sheet).getByRole('button', { name: ko.common.save }),
    }
    // 기본 오늘, 생일 전과 미래는 고를 수 없음.
    expect(ui.date.value).toBe('2026-11-10')
    expect(ui.date.min).toBe(SKY.birth_date)
    expect(ui.date.max).toBe('2026-11-10')

    // 빈 이름, 공백만, 31자 거부.
    await user.click(ui.save)
    expect(
      await within(sheet).findByText(ko.milestones.errors.labelInvalid),
    ).toBeInTheDocument()
    fireEvent.change(ui.name, { target: { value: '   ' } })
    await user.click(ui.save)
    expect(
      within(sheet).getByText(ko.milestones.errors.labelInvalid),
    ).toBeInTheDocument()
    fireEvent.change(ui.name, { target: { value: '가'.repeat(31) } })
    fireEvent.change(ui.date, { target: { value: '2025-09-25' } })
    fireEvent.change(ui.note, { target: { value: '나'.repeat(101) } })
    await user.click(ui.save)
    expect(
      within(sheet).getByText(ko.milestones.errors.labelInvalid),
    ).toBeInTheDocument()
    expect(
      within(sheet).getByText(ko.milestones.errors.dateRange),
    ).toBeInTheDocument()
    expect(
      within(sheet).getByText(ko.milestones.errors.noteTooLong),
    ).toBeInTheDocument()
    expect(posts).toEqual([])

    // 서버 에러 키 번역.
    fail = true
    fireEvent.change(ui.name, { target: { value: '가'.repeat(30) } })
    fireEvent.change(ui.date, { target: { value: '2026-11-10' } })
    fireEvent.change(ui.note, { target: { value: '' } })
    await user.click(ui.save)
    expect(
      await within(sheet).findByText(ko.errors.milestone.labelInvalid),
    ).toBeInTheDocument()

    // 정상 저장. 앞뒤 공백 제거, 빈 메모는 없음, preset_key 없음.
    fail = false
    const before = listGets.length
    fireEvent.change(ui.name, { target: { value: '  첫 수영  ' } })
    await user.click(ui.save)
    await waitFor(() => {
      expect(sheet).not.toBeInTheDocument()
    })
    expect(posts.at(-1)).toEqual({
      custom_label: '첫 수영',
      achieved_on: '2026-11-10',
      note: null,
      asset_ids: [],
    })
    await waitFor(() => {
      expect(listGets.length).toBeGreaterThan(before)
    })
  })

  it('duplicate_preset_error', async () => {
    const { user, listGets } = setup(`/babies/${SKY.id}`, {
      milestones: [],
      extra: {
        [`POST /api/babies/${SKY.id}/milestones`]: () =>
          apiError(409, 'milestone.duplicate'),
      },
    })
    const picker = await openPicker(user)
    await user.click(within(picker).getByRole('button', { name: /^혼자 걷기/ }))
    const sheet = await screen.findByRole('dialog', { name: '혼자 걷기' })
    const before = listGets.length
    await user.click(
      within(sheet).getByRole('button', { name: ko.common.save }),
    )
    expect(
      await within(sheet).findByText(ko.errors.milestone.duplicate),
    ).toBeInTheDocument()
    // 다른 보호자가 먼저 기록. 목록 다시 받아 고르기 시트와 타임라인 갱신.
    await waitFor(() => {
      expect(listGets.length).toBeGreaterThan(before)
    })
  })

  it('save_with_new_photo_attach', async () => {
    const log: string[] = []
    const posts: unknown[] = []
    add.mockImplementation(() => {
      log.push('add')
      return ['f1']
    })
    const { user } = setup(`/babies/${SKY.id}`, {
      milestones: [],
      extra: {
        [`POST /api/babies/${SKY.id}/milestones`]: async (req) => {
          posts.push(await req.json())
          log.push('post')
          return json(
            201,
            milestoneFixture('m1', {
              baby_id: SKY.id,
              preset_key: 'walk_alone',
              achieved_on: '2026-11-10',
            }),
          )
        },
      },
    })
    const picker = await openPicker(user)
    await user.click(within(picker).getByRole('button', { name: /^혼자 걷기/ }))
    const sheet = await screen.findByRole('dialog', { name: '혼자 걷기' })
    // 범위 안내.
    expect(within(sheet).getByText('보통 8~18개월')).toBeInTheDocument()
    const file = new File(['x'], 'walk.jpg', { type: 'image/jpeg' })
    await pickFile(user, sheet, file)

    // 미리보기만 띠에. 저장 전엔 업로드 없음.
    const strip = await within(sheet).findByRole('list', {
      name: ko.stories.photos,
    })
    expect(within(strip).getAllByRole('listitem')).toHaveLength(1)
    expect(
      within(sheet).getByText(ko.milestones.uploadHint),
    ).toBeInTheDocument()
    expect(add).not.toHaveBeenCalled()

    fireEvent.change(within(sheet).getByLabelText(ko.milestones.note), {
      target: { value: ' 놀이터에서 ' },
    })
    await user.click(
      within(sheet).getByRole('button', { name: ko.common.save }),
    )
    await waitFor(() => {
      expect(add).toHaveBeenCalledWith([file], [SKY.id], {
        kind: 'milestone',
        id: 'm1',
      })
    })
    expect(log).toEqual(['post', 'add'])
    expect(posts[0]).toEqual({
      preset_key: 'walk_alone',
      achieved_on: '2026-11-10',
      note: '놀이터에서',
      asset_ids: [],
    })
    await waitFor(() => {
      expect(sheet).not.toBeInTheDocument()
    })
  })

  it('timeline_order_and_age', async () => {
    setup(`/babies/${SKY.id}`)
    const s = await section()
    const list = await within(s).findByRole('list', {
      name: ko.milestones.listLabel,
    })
    const links = within(list).getAllByRole('link')
    // 최근 순. 이름, 날짜, 그때 나이, 사진 수.
    expect(links.map((l) => l.getAttribute('aria-label'))).toEqual([
      '혼자 걷기, 11월 1일, 1살 1개월, 사진 1장',
      '첫 수영, 8월 15일, 10개월 20일',
      '첫 웃음, 2025년 11월 20일, 생후 56일',
    ])
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/milestones/m1',
      '/milestones/m2',
      '/milestones/m3',
    ])
    // 사진 썸네일(장식).
    expect(links[0]?.querySelectorAll('img')).toHaveLength(1)
    expect(
      within(s).getByRole('button', { name: ko.milestones.addLabel }),
    ).toBeInTheDocument()
  })

  it('unborn_cannot_record', async () => {
    const DUE = babyFixture({ birth_date: '2026-12-01' })
    setup(`/babies/${DUE.id}`, { babies: [DUE], milestones: [] })
    const s = await section()
    expect(await within(s).findByText(ko.milestones.unborn)).toBeInTheDocument()
    expect(
      within(s).queryByRole('button', { name: ko.milestones.addLabel }),
    ).not.toBeInTheDocument()
  })

  it('detail_range_note', async () => {
    const { router } = setup('/milestones/m1')
    expect(
      await screen.findByRole('heading', { level: 1, name: '혼자 걷기' }),
    ).toBeInTheDocument()
    expect(screen.getByText('2026년 11월 1일 · 1살 1개월')).toBeInTheDocument()
    expect(
      screen.getByText('보통 8~18개월 · 아이마다 시기가 달라요'),
    ).toBeInTheDocument()
    const grid = screen.getByRole('list', { name: ko.milestones.photoGrid })
    expect(within(grid).getByRole('link')).toHaveAttribute(
      'href',
      '/photos/a1?from=milestone&of=m1',
    )
    expect(
      screen.getByRole('button', { name: ko.milestones.menu }),
    ).toBeInTheDocument()

    // 직접 입력은 범위 없음, 메모 표시.
    await router.navigate({ to: '/milestones/$id', params: { id: 'm2' } })
    expect(
      await screen.findByRole('heading', { level: 1, name: '첫 수영' }),
    ).toBeInTheDocument()
    expect(screen.getByText('바닷가')).toBeInTheDocument()
    expect(screen.queryByText(/아이마다 시기가 달라요/)).toBeNull()

    // CDC 기준 문구.
    await router.navigate({ to: '/milestones/$id', params: { id: 'm3' } })
    expect(
      await screen.findByText('대부분 2개월까지 · 아이마다 시기가 달라요'),
    ).toBeInTheDocument()
  })

  it('edit_sends_changed_fields', async () => {
    const patches: unknown[] = []
    const a2 = assetSummaryFixture('a2')
    const a9 = assetSummaryFixture('a9')
    let server = [A1, a2]
    const base = MILESTONES[2]
    if (!base) throw new Error('fixture')
    const m1 = () => ({ ...base, assets: server, asset_count: server.length })
    const { user } = setup('/milestones/m1', {
      extra: {
        'GET /api/milestones/m1': () => json(200, m1()),
        'PATCH /api/milestones/m1': async (req) => {
          patches.push(await req.json())
          return json(200, m1())
        },
      },
    })
    async function openEdit() {
      await user.click(
        await screen.findByRole('button', { name: ko.milestones.menu }),
      )
      await user.click(
        await screen.findByRole('menuitem', { name: ko.milestones.edit }),
      )
      return screen.findByRole('dialog', { name: ko.milestones.editTitle })
    }

    // 메모만 바꾸면 메모만.
    let sheet = await openEdit()
    const note = within(sheet).getByLabelText<HTMLInputElement>(
      ko.milestones.note,
    )
    expect(note.value).toBe('')
    expect(
      within(sheet).queryByLabelText(ko.milestones.name),
    ).not.toBeInTheDocument()
    fireEvent.change(note, { target: { value: '첫걸음' } })
    await user.click(
      within(sheet).getByRole('button', { name: ko.common.save }),
    )
    await waitFor(() => {
      expect(sheet).not.toBeInTheDocument()
    })
    expect(patches).toEqual([{ note: '첫걸음' }])

    // 사진을 빼면 저장 직전 상세를 다시 받아 그사이 붙은 사진(a9) 보존.
    sheet = await openEdit()
    server = [A1, a2, a9]
    await user.click(
      within(sheet).getByRole('button', {
        name: ko.stories.removePhoto.replace('{{index}}', '1'),
      }),
    )
    await user.click(
      within(sheet).getByRole('button', { name: ko.common.save }),
    )
    await waitFor(() => {
      expect(sheet).not.toBeInTheDocument()
    })
    expect(patches.at(-1)).toEqual({ asset_ids: ['a2', 'a9'] })
  })

  it('detail_delete', async () => {
    const deletes: string[] = []
    let getsAfterDelete = 0
    const m2 = MILESTONES[1]
    const { user, router, queryClient } = setup('/milestones/m2', {
      extra: {
        'GET /api/milestones/m2': () => {
          if (deletes.length === 0) return json(200, m2)
          getsAfterDelete += 1
          return apiError(404, 'milestone.notFound')
        },
        'DELETE /api/milestones/m2': () => {
          deletes.push('m2')
          return json(204, null)
        },
      },
    })
    await user.click(
      await screen.findByRole('button', { name: ko.milestones.menu }),
    )
    await user.click(
      await screen.findByRole('menuitem', { name: ko.milestones.delete }),
    )
    const dialog = await screen.findByRole('dialog', {
      name: ko.milestones.deleteTitle,
    })
    // 캐시 제거 시점의 화면. 상세가 남아 있으면 다시 받아 404 깜박임.
    const removedAt: string[] = []
    const remove = queryClient.removeQueries.bind(queryClient)
    vi.spyOn(queryClient, 'removeQueries').mockImplementation((filters) => {
      removedAt.push(router.state.resolvedLocation?.pathname ?? '')
      remove(filters)
    })
    await user.click(
      within(dialog).getByRole('button', { name: ko.milestones.delete }),
    )
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/babies/${SKY.id}`)
    })
    await waitFor(() => {
      expect(removedAt).toEqual([`/babies/${SKY.id}`])
    })
    expect(deletes).toEqual(['m2'])
    // 떠나기 전 캐시를 지우면 남은 화면이 다시 받아 404(찾을 수 없음 깜박임).
    await new Promise((r) => setTimeout(r, 50))
    expect(getsAfterDelete).toBe(0)
    expect(screen.queryByText(ko.errors.milestone.notFound)).toBeNull()
  })

  it('edit_keeps_background_attach', async () => {
    const patches: unknown[] = []
    const a9 = assetSummaryFixture('a9')
    let server = [A1]
    const base = MILESTONES[2]
    if (!base) throw new Error('fixture')
    const m1 = () => ({ ...base, assets: server, asset_count: server.length })
    const { user, queryClient } = setup('/milestones/m1', {
      extra: {
        'GET /api/milestones/m1': () => json(200, m1()),
        'PATCH /api/milestones/m1': async (req) => {
          patches.push(await req.json())
          return json(200, m1())
        },
      },
    })
    await user.click(
      await screen.findByRole('button', { name: ko.milestones.menu }),
    )
    await user.click(
      await screen.findByRole('menuitem', { name: ko.milestones.edit }),
    )
    const sheet = await screen.findByRole('dialog', {
      name: ko.milestones.editTitle,
    })

    // 시트가 열린 사이 업로드 완료로 서버가 a9 연결, 상세 재조회.
    server = [A1, a9]
    await queryClient.invalidateQueries({ queryKey: milestoneKey('m1') })
    // 시트 뒤(모달 바깥) 상세 격자. 접근성 트리에서 숨김이라 hidden 포함 조회.
    await waitFor(() => {
      const grid = screen.getByRole('list', {
        name: ko.milestones.photoGrid,
        hidden: true,
      })
      expect(within(grid).getAllByRole('link', { hidden: true })).toHaveLength(
        2,
      )
    })

    // 사진은 그대로, 메모만 바꿈. asset_ids 없음(a9 연결 유지).
    fireEvent.change(within(sheet).getByLabelText(ko.milestones.note), {
      target: { value: '첫걸음' },
    })
    await user.click(
      within(sheet).getByRole('button', { name: ko.common.save }),
    )
    await waitFor(() => {
      expect(sheet).not.toBeInTheDocument()
    })
    expect(patches).toEqual([{ note: '첫걸음' }])
  })

  it('family_read_only', async () => {
    setup(`/babies/${SKY.id}`, { role: 'family' })
    const s = await section()
    const list = await within(s).findByRole('list', {
      name: ko.milestones.listLabel,
    })
    expect(within(list).getAllByRole('link')).toHaveLength(3)
    expect(
      within(s).queryByRole('button', { name: ko.milestones.addLabel }),
    ).not.toBeInTheDocument()
    cleanup()

    setup('/milestones/m1', { role: 'family' })
    expect(
      await screen.findByRole('heading', { level: 1, name: '혼자 걷기' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: ko.milestones.menu }),
    ).not.toBeInTheDocument()
  })
})
