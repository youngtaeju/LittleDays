import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Baby, GrowthRecord, Role } from '@/api/types'
import { initI18n } from '@/i18n'
import ko from '@/locales/ko.json'
import { json, mockFetch } from '@/test/fetch'
import {
  apiError,
  babyFixture,
  settingsFixture,
  userFixture,
} from '@/test/fixtures'
import { renderApp } from '@/test/router'
import { GrowthChart } from './GrowthChart'

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

const SKY = babyFixture({ birth_date: '2025-09-26', sex: 'male' })

function record(
  id: string,
  measured_on: string,
  height_cm: number | null,
  weight_kg: number | null,
  over: Partial<GrowthRecord> = {},
): GrowthRecord {
  return {
    id,
    baby_id: SKY.id,
    measured_on,
    height_cm,
    weight_kg,
    note: null,
    created_by: '00000000-0000-4000-8000-000000000001',
    created_at: `${measured_on}T03:00:00Z`,
    updated_at: `${measured_on}T03:00:00Z`,
    ...over,
  }
}

// 서버 정렬(잰 날 오름차순).
const RECORDS = [
  record('r1', '2025-09-26', 50, 3.3),
  record('r2', '2026-03-26', 67.5, null),
  record('r3', '2026-11-03', 76.2, 9.1, { note: '병원' }),
]

const EMPTY_STATS = {
  photo_count: 0,
  video_count: 0,
  day_count: 0,
  age_months: [],
}

type Routes = Parameters<typeof mockFetch>[0]

function renderGrowth(
  path: string,
  opts: {
    role?: Role
    babies?: Baby[]
    records?: GrowthRecord[]
    extra?: Routes
  } = {},
) {
  const babies = opts.babies ?? [SKY]
  const growthGets: string[] = []
  mockFetch({
    'GET /api/auth/me': () =>
      json(200, { user: userFixture(opts.role ?? 'guardian') }),
    'GET /api/settings': () => json(200, settingsFixture),
    'GET /api/babies': () => json(200, babies),
    ...Object.fromEntries(
      babies.flatMap((b) => [
        [`GET /api/babies/${b.id}/stats`, () => json(200, EMPTY_STATS)],
        [
          `GET /api/babies/${b.id}/growth`,
          () => {
            growthGets.push(b.id)
            return json(200, b.id === SKY.id ? (opts.records ?? RECORDS) : [])
          },
        ],
      ]),
    ),
    ...opts.extra,
  })
  return { ...renderApp(path), growthGets }
}

function points(): number {
  return screen.getByTestId('growth-points').querySelectorAll('circle').length
}

describe('growth', () => {
  it('section_latest_and_tabs', async () => {
    const { user } = renderGrowth(`/babies/${SKY.id}`)
    const section = await screen.findByRole('region', {
      name: ko.growth.title,
    })
    expect(
      await within(section).findByText('76.2cm · 9.1kg · 11월 3일'),
    ).toBeInTheDocument()

    const heightTab = within(section).getByRole('tab', {
      name: ko.growth.height,
    })
    const weightTab = within(section).getByRole('tab', {
      name: ko.growth.weight,
    })
    expect(heightTab).toHaveAttribute('aria-selected', 'true')
    expect(
      within(section).getByRole('img', { name: ko.growth.heightChart }),
    ).toBeInTheDocument()
    expect(points()).toBe(3)
    expect(screen.getByTestId('growth-curves')).toBeInTheDocument()
    // 대체 텍스트 요약. 만 개월, 값은 최근 값 줄과 같은 형식.
    expect(
      within(section).getByRole('img', { name: ko.growth.heightChart }),
    ).toHaveAccessibleDescription('기록 3개, 0~13개월, 50cm~76.2cm')

    // 우리 아이 선과 점은 accent-ink(대비 3:1 이상), 50 백분위 점선은 불투명 muted-foreground.
    const own = screen.getByTestId('growth-points')
    const ownLine = own.querySelector('path')
    expect(ownLine).toHaveClass('stroke-accent-ink')
    for (const c of Array.from(own.querySelectorAll('circle'))) {
      expect(c).toHaveClass('fill-accent-ink')
    }
    const dashed = screen
      .getByTestId('growth-curves')
      .querySelector('path[stroke-dasharray]')
    expect(dashed).toHaveClass('stroke-muted-foreground')
    expect(dashed?.getAttribute('class')).not.toMatch(/\//)

    await user.click(weightTab)
    expect(weightTab).toHaveAttribute('aria-selected', 'true')
    expect(heightTab).toHaveAttribute('aria-selected', 'false')
    expect(
      within(section).getByRole('img', { name: ko.growth.weightChart }),
    ).toBeInTheDocument()
    // 몸무게 없는 기록(r2)은 점 없음.
    expect(points()).toBe(2)
    expect(
      within(section).getByRole('img', { name: ko.growth.weightChart }),
    ).toHaveAccessibleDescription('기록 2개, 0~13개월, 3.3kg~9.1kg')

    expect(
      within(section).getByRole('button', { name: ko.growth.addLabel }),
    ).toBeInTheDocument()
    expect(
      within(section).getByRole('link', { name: ko.growth.viewAll }),
    ).toHaveAttribute('href', `/babies/${SKY.id}/growth`)
  })

  it('chart_without_curves', () => {
    // 성별 없음. 곡선 없이 점만, 안내 한 줄.
    const { unmount } = render(
      <GrowthChart
        records={RECORDS}
        baby={{ ...SKY, sex: null }}
        kind="height"
      />,
    )
    expect(screen.queryByTestId('growth-curves')).not.toBeInTheDocument()
    expect(points()).toBe(3)
    expect(screen.getByText(ko.growth.noSexHint)).toBeInTheDocument()
    unmount()

    // 60개월 넘는 기록만. 곡선 없음.
    const old = [
      record('o1', '2030-10-26', 112, 19.5),
      record('o2', '2031-03-26', 115, null),
    ]
    const second = render(
      <GrowthChart records={old} baby={SKY} kind="height" />,
    )
    expect(screen.queryByTestId('growth-curves')).not.toBeInTheDocument()
    expect(screen.queryByText(ko.growth.noSexHint)).not.toBeInTheDocument()
    expect(points()).toBe(2)
    second.unmount()

    // 60개월 안팎 섞임. 곡선은 60개월까지, 점은 전부.
    render(
      <GrowthChart
        records={[record('a', '2026-09-26', 75, 9.6), ...old]}
        baby={SKY}
        kind="height"
      />,
    )
    const curves = screen.getByTestId('growth-curves')
    expect(points()).toBe(3)
    const lastX = Math.max(
      ...Array.from(
        screen.getByTestId('growth-points').querySelectorAll('circle'),
      ).map((c) => Number(c.getAttribute('cx'))),
    )
    expect(Number(curves.getAttribute('data-end-x'))).toBeLessThan(lastX)
  })

  it('sheet_validates', async () => {
    const posts: unknown[] = []
    let fail = false
    const { user, growthGets } = renderGrowth(`/babies/${SKY.id}`, {
      extra: {
        [`POST /api/babies/${SKY.id}/growth`]: async (req) => {
          posts.push(await req.json())
          if (fail) return apiError(400, 'growth.valueInvalid')
          return json(201, record('r4', '2026-11-10', 77, null))
        },
      },
    })
    const section = await screen.findByRole('region', {
      name: ko.growth.title,
    })
    await user.click(
      await within(section).findByRole('button', { name: ko.growth.addLabel }),
    )
    const sheet = await screen.findByRole('dialog', {
      name: ko.growth.newTitle,
    })
    const ui = {
      date: within(sheet).getByLabelText<HTMLInputElement>(ko.growth.date),
      height: within(sheet).getByLabelText<HTMLInputElement>(
        ko.growth.heightField,
      ),
      weight: within(sheet).getByLabelText<HTMLInputElement>(
        ko.growth.weightField,
      ),
      note: within(sheet).getByLabelText<HTMLInputElement>(ko.growth.note),
      save: within(sheet).getByRole('button', { name: ko.common.save }),
    }
    // 기본 오늘, 생일 전과 미래는 고를 수 없음.
    expect(ui.date.value).toBe('2026-11-10')
    expect(ui.date.min).toBe(SKY.birth_date)
    expect(ui.date.max).toBe('2026-11-10')
    expect(ui.height).toHaveAttribute('inputmode', 'decimal')
    expect(ui.weight).toHaveAttribute('inputmode', 'decimal')

    // 둘 다 비면 거부.
    await user.click(ui.save)
    expect(
      await within(sheet).findByText(ko.growth.errors.valueRequired),
    ).toBeInTheDocument()

    // 범위, 소수 자리, 메모 길이, 날짜.
    await user.type(ui.height, '15')
    await user.type(ui.weight, '9.255')
    fireEvent.change(ui.note, { target: { value: '가'.repeat(101) } })
    fireEvent.change(ui.date, { target: { value: '2025-09-25' } })
    await user.click(ui.save)
    expect(
      await within(sheet).findByText(ko.growth.errors.heightInvalid),
    ).toBeInTheDocument()
    expect(
      within(sheet).getByText(ko.growth.errors.weightInvalid),
    ).toBeInTheDocument()
    expect(
      within(sheet).getByText(ko.growth.errors.noteTooLong),
    ).toBeInTheDocument()
    expect(
      within(sheet).getByText(ko.growth.errors.dateRange),
    ).toBeInTheDocument()

    await user.clear(ui.height)
    await user.type(ui.height, '75.25')
    await user.click(ui.save)
    expect(
      await within(sheet).findByText(ko.growth.errors.heightInvalid),
    ).toBeInTheDocument()
    expect(posts).toEqual([])

    // 서버 에러 키 번역.
    fail = true
    await user.clear(ui.height)
    await user.type(ui.height, '77')
    await user.clear(ui.weight)
    fireEvent.change(ui.note, { target: { value: '' } })
    fireEvent.change(ui.date, { target: { value: '2026-11-10' } })
    await user.click(ui.save)
    expect(
      await within(sheet).findByText(ko.errors.growth.valueInvalid),
    ).toBeInTheDocument()

    // 정상 저장. 쉼표 소수점 허용, 메모 앞뒤 공백 제거.
    fail = false
    const before = growthGets.length
    await user.type(ui.weight, '9,25')
    fireEvent.change(ui.note, { target: { value: '  병원  ' } })
    await user.click(ui.save)
    await waitFor(() => {
      expect(sheet).not.toBeInTheDocument()
    })
    expect(posts.at(-1)).toEqual({
      measured_on: '2026-11-10',
      height_cm: 77,
      weight_kg: 9.25,
      note: '병원',
    })
    await waitFor(() => {
      expect(growthGets.length).toBeGreaterThan(before)
    })
  })

  it('family_no_add', async () => {
    renderGrowth(`/babies/${SKY.id}`, { role: 'family' })
    const section = await screen.findByRole('region', {
      name: ko.growth.title,
    })
    expect(
      await within(section).findByText('76.2cm · 9.1kg · 11월 3일'),
    ).toBeInTheDocument()
    expect(
      within(section).queryByRole('button', { name: ko.growth.addLabel }),
    ).not.toBeInTheDocument()
    cleanup()

    // 목록은 읽기만. 줄을 눌러 고칠 수 없음.
    renderGrowth(`/babies/${SKY.id}/growth`, { role: 'family' })
    const list = await screen.findByRole('list', { name: ko.growth.listLabel })
    expect(await within(list).findAllByRole('listitem')).toHaveLength(3)
    expect(within(list).queryAllByRole('button')).toEqual([])
    expect(
      screen.queryByRole('button', { name: ko.growth.addLabel }),
    ).not.toBeInTheDocument()
  })

  it('unborn_cannot_record', async () => {
    const DUE = babyFixture({ birth_date: '2026-12-01', sex: 'female' })
    renderGrowth(`/babies/${DUE.id}`, { babies: [DUE] })
    const section = await screen.findByRole('region', {
      name: ko.growth.title,
    })
    expect(
      await within(section).findByText(ko.growth.unborn),
    ).toBeInTheDocument()
    expect(
      within(section).queryByRole('button', { name: ko.growth.addLabel }),
    ).not.toBeInTheDocument()
  })

  it('list_edit_delete', async () => {
    const patches: unknown[] = []
    const deletes: string[] = []
    const { user, growthGets } = renderGrowth(`/babies/${SKY.id}/growth`, {
      extra: {
        'PATCH /api/growth/r3': async (req) => {
          patches.push(await req.json())
          return json(200, record('r3', '2026-11-03', 76.2, 9.2))
        },
        'DELETE /api/growth/r2': () => {
          deletes.push('r2')
          return json(204, null)
        },
      },
    })
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: '하늘 성장 기록',
      }),
    ).toBeInTheDocument()
    const list = screen.getByRole('list', { name: ko.growth.listLabel })
    const rows = await within(list).findAllByRole('listitem')
    // 잰 날 내림차순.
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('2026년 11월 3일'),
      expect.stringContaining('2026년 3월 26일'),
      expect.stringContaining('2025년 9월 26일'),
    ])
    expect(rows[0]).toHaveTextContent('병원')

    // 고치기. 기존 값 채움, 보낸 결과 반영.
    const first = rows[0]
    if (!first) throw new Error('줄 없음')
    await user.click(within(first).getByRole('button'))
    let sheet = await screen.findByRole('dialog', {
      name: ko.growth.editTitle,
    })
    const weight = within(sheet).getByLabelText<HTMLInputElement>(
      ko.growth.weightField,
    )
    expect(
      within(sheet).getByLabelText<HTMLInputElement>(ko.growth.heightField)
        .value,
    ).toBe('76.2')
    expect(weight.value).toBe('9.1')
    expect(
      within(sheet).getByLabelText<HTMLInputElement>(ko.growth.note).value,
    ).toBe('병원')
    await user.clear(weight)
    await user.type(weight, '9.2')
    const before = growthGets.length
    await user.click(
      within(sheet).getByRole('button', { name: ko.common.save }),
    )
    await waitFor(() => {
      expect(sheet).not.toBeInTheDocument()
    })
    expect(patches).toEqual([
      {
        measured_on: '2026-11-03',
        height_cm: 76.2,
        weight_kg: 9.2,
        note: '병원',
      },
    ])
    await waitFor(() => {
      expect(growthGets.length).toBeGreaterThan(before)
    })

    // 지우기. 확인 후 삭제.
    const second = within(list).getAllByRole('listitem')[1]
    if (!second) throw new Error('줄 없음')
    await user.click(within(second).getByRole('button'))
    sheet = await screen.findByRole('dialog', { name: ko.growth.editTitle })
    await user.click(
      within(sheet).getByRole('button', { name: ko.growth.delete }),
    )
    expect(deletes).toEqual([])
    expect(within(sheet).getByText(ko.growth.deleteConfirm)).toBeInTheDocument()
    await user.click(
      within(sheet).getByRole('button', { name: ko.growth.deleteSubmit }),
    )
    await waitFor(() => {
      expect(sheet).not.toBeInTheDocument()
    })
    expect(deletes).toEqual(['r2'])
  })
})
