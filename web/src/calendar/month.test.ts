import { describe, expect, it } from 'vitest'
import { dayFixture } from '@/test/fixtures'
import {
  addMonths,
  defaultDate,
  isMonth,
  monthCells,
  monthRange,
} from './month'

describe('month', () => {
  it('cells_start_on_sunday', () => {
    // 2026-11-01 일요일. 앞 빈칸 없음.
    const nov = monthCells('2026-11')
    expect(nov).toHaveLength(30)
    expect(nov[0]).toBe('2026-11-01')
    expect(nov.at(-1)).toBe('2026-11-30')

    // 2026-08-01 토요일. 앞 빈칸 6, 6주.
    const aug = monthCells('2026-08')
    expect(aug.slice(0, 6)).toEqual([null, null, null, null, null, null])
    expect(aug[6]).toBe('2026-08-01')
    expect(aug).toHaveLength(37)
    expect(Math.ceil(aug.length / 7)).toBe(6)
  })

  it('cells_leap_year', () => {
    // 2028-02-01 화요일. 윤년 29일.
    const feb = monthCells('2028-02')
    expect(feb.slice(0, 3)).toEqual([null, null, '2028-02-01'])
    expect(feb.at(-1)).toBe('2028-02-29')
    expect(feb).toHaveLength(31)
    expect(monthCells('2027-02').at(-1)).toBe('2027-02-28')
  })

  it('add_months_year_boundary', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(addMonths('2026-11', -13)).toBe('2025-10')
    expect(addMonths('2026-11', 0)).toBe('2026-11')
  })

  it('month_range', () => {
    expect(monthRange('2026-11')).toEqual({
      from: '2026-11-01',
      to: '2026-11-30',
    })
    expect(monthRange('2028-02')).toEqual({
      from: '2028-02-01',
      to: '2028-02-29',
    })
  })

  it('is_month', () => {
    expect(isMonth('2026-11')).toBe(true)
    expect(isMonth('2026-13')).toBe(false)
    expect(isMonth('2026-00')).toBe(false)
    expect(isMonth('2026-1')).toBe(false)
    expect(isMonth('2026-11-01')).toBe(false)
  })

  it('default_date', () => {
    const days = [
      dayFixture('2026-10-03'),
      dayFixture('2026-10-20'),
      dayFixture('2026-10-11'),
    ]
    // 이번 달이면 오늘(기록 유무 무관).
    expect(defaultDate('2026-11', '2026-11-13', [])).toBe('2026-11-13')
    // 지난 달은 마지막 기록한 날.
    expect(defaultDate('2026-10', '2026-11-13', days)).toBe('2026-10-20')
    // 기록 없으면 고른 날 없음.
    expect(defaultDate('2026-09', '2026-11-13', days)).toBeUndefined()
  })
})
