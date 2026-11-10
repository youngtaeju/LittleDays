import { describe, expect, it } from 'vitest'
import i18next from 'i18next'
import { beforeAll } from 'vitest'
import { initI18n } from '@/i18n'
import {
  ageAt,
  dayNumber,
  dueIn,
  formatAgeLine,
  formatNextAnniversary,
  formatSpecialDay,
  nextAnniversary,
  specialDay,
} from './age'

const birth = '2024-01-31'

describe('ageAt', () => {
  it.each([
    ['2024-01-31', { kind: 'days', days: 0 }],
    ['2024-05-09', { kind: 'days', days: 99 }],
    ['2024-05-10', { kind: 'monthsDays', months: 3, days: 10 }],
    ['2024-02-29', { kind: 'days', days: 29 }],
    ['2025-01-30', { kind: 'monthsDays', months: 11, days: 30 }],
    ['2025-01-31', { kind: 'yearsMonths', years: 1, months: 0 }],
    ['2026-03-01', { kind: 'yearsMonths', years: 2, months: 1 }],
  ])('age_on_%s', (date, expected) => {
    expect(ageAt(birth, date)).toEqual(expected)
  })

  // 말일 생일: 말일 보정 기념일 당일이 0일.
  it.each([
    ['2024-09-30', { kind: 'monthsDays', months: 6, days: 0 }],
    ['2024-10-01', { kind: 'monthsDays', months: 6, days: 1 }],
  ])('month_end_birth_on_%s', (date, expected) => {
    expect(ageAt('2024-03-31', date)).toEqual(expected)
  })

  it('before_birth_is_null', () => {
    expect(ageAt(birth, '2024-01-30')).toBeNull()
  })
})

describe('due_in', () => {
  it('days_until_birth', () => {
    expect(dueIn('2024-03-10', '2024-03-01')).toBe(9)
    expect(dueIn('2024-03-10', '2024-03-10')).toBeNull()
    expect(dueIn('2024-03-10', '2024-03-11')).toBeNull()
  })
})

describe('day_number', () => {
  it('birth_day_is_one', () => {
    expect(dayNumber('2024-01-31', '2024-01-31')).toBe(1)
    expect(dayNumber('2024-01-31', '2024-02-01')).toBe(2)
  })
})

describe('special_days', () => {
  it.each([
    ['2024-05-09', { kind: 'days', n: 100 }],
    ['2024-08-17', { kind: 'days', n: 200 }],
    ['2024-11-25', { kind: 'days', n: 300 }],
    ['2025-01-31', { kind: 'birthday', n: 1 }],
    ['2027-01-31', { kind: 'birthday', n: 3 }],
    ['2024-05-08', null],
    ['2024-05-10', null],
    ['2024-01-31', null],
    ['2024-01-30', null],
  ])('special_on_%s', (date, expected) => {
    expect(specialDay('2024-01-31', date)).toEqual(expected)
  })

  it('leap_day_birth_uses_feb_28_in_common_years', () => {
    expect(specialDay('2024-02-29', '2025-02-28')).toEqual({
      kind: 'birthday',
      n: 1,
    })
    expect(specialDay('2024-02-29', '2025-03-01')).toBeNull()
    expect(specialDay('2024-02-29', '2028-02-29')).toEqual({
      kind: 'birthday',
      n: 4,
    })
  })
})

describe('next_anniversary', () => {
  it('hundred_days_ahead', () => {
    // dayNumber 98 → 100일까지 2일.
    expect(nextAnniversary('2024-01-31', '2024-05-07')).toEqual({
      day: { kind: 'days', n: 100 },
      inDays: 2,
    })
  })
  it('excludes_today', () => {
    expect(nextAnniversary('2024-01-31', '2024-05-09')).toEqual({
      day: { kind: 'days', n: 200 },
      inDays: 100,
    })
  })
  it('day_before_first_birthday', () => {
    expect(nextAnniversary('2024-01-31', '2025-01-30')).toEqual({
      day: { kind: 'birthday', n: 1 },
      inDays: 1,
    })
  })
  it('after_300_picks_birthday', () => {
    expect(nextAnniversary('2024-01-31', '2024-12-01')?.day).toEqual({
      kind: 'birthday',
      n: 1,
    })
  })
  it('before_birth_is_null', () => {
    expect(nextAnniversary('2024-01-31', '2024-01-01')).toBeNull()
  })
})

describe('age_matches_server_rule', () => {
  it.each([
    ['2024-01-31', '2024-02-28', { kind: 'days', days: 28 }],
    ['2024-01-31', '2024-04-30', { kind: 'days', days: 90 }],
    ['2024-02-29', '2025-02-28', { kind: 'yearsMonths', years: 1, months: 0 }],
  ])('%s_on_%s', (b, d, expected) => {
    expect(ageAt(b, d)).toEqual(expected)
  })
})

describe('formatting', () => {
  beforeAll(() => {
    initI18n('ko')
  })

  it('ko', async () => {
    await i18next.changeLanguage('ko')
    const t = i18next.t.bind(i18next)
    expect(formatSpecialDay(t, { kind: 'days', n: 100 })).toBe('100일')
    expect(formatSpecialDay(t, { kind: 'birthday', n: 1 })).toBe('첫 생일')
    expect(formatSpecialDay(t, { kind: 'birthday', n: 2 })).toBe('두 번째 생일')
    expect(formatSpecialDay(t, { kind: 'birthday', n: 10 })).toBe(
      '열 번째 생일',
    )
    expect(formatSpecialDay(t, { kind: 'birthday', n: 11 })).toBe('11번째 생일')
    expect(formatAgeLine(t, '2024-03-10', '2024-03-01')).toBe('출산 예정 D-9')
    expect(formatAgeLine(t, '2024-03-10', '2024-03-12')).toBe('생후 2일')
    expect(
      formatNextAnniversary(t, { day: { kind: 'days', n: 100 }, inDays: 2 }),
    ).toBe('100일까지 2일')
  })

  it('en', async () => {
    await i18next.changeLanguage('en')
    const t = i18next.t.bind(i18next)
    expect(formatSpecialDay(t, { kind: 'days', n: 200 })).toBe('Day 200')
    const ord = [1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map((n) =>
      formatSpecialDay(t, { kind: 'birthday', n }),
    )
    expect(ord).toEqual([
      '1st birthday',
      '2nd birthday',
      '3rd birthday',
      '4th birthday',
      '11th birthday',
      '12th birthday',
      '13th birthday',
      '21st birthday',
      '22nd birthday',
      '23rd birthday',
    ])
    expect(formatAgeLine(t, '2024-03-10', '2024-03-01')).toBe('Due in 9 d')
    expect(
      formatNextAnniversary(t, { day: { kind: 'days', n: 100 }, inDays: 2 }),
    ).toBe('2 d until Day 100')
  })
})
