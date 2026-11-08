import { describe, expect, it } from 'vitest'
import { ageAt } from './age'

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
