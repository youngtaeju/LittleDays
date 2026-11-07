import type { TFunction } from 'i18next'

export type Age =
  | { kind: 'days'; days: number }
  | { kind: 'monthsDays'; months: number; days: number }
  | { kind: 'yearsMonths'; years: number; months: number }

const DAY_MS = 86_400_000

// YYYY-MM-DD → [연, 월(1~12), 일].
function parts(date: string): [number, number, number] {
  const [y = 0, m = 0, d = 0] = date.split('-').map(Number)
  return [y, m, d]
}

function utcDay(y: number, m: number, d: number): number {
  return Date.UTC(y, m - 1, d) / DAY_MS
}

// 달력 날짜끼리 계산. 시간대 무관.
export function ageAt(birthDate: string, date: string): Age | null {
  const [by, bm, bd] = parts(birthDate)
  const [y, m, d] = parts(date)
  const days = utcDay(y, m, d) - utcDay(by, bm, bd)
  if (days < 0) return null
  if (days < 100) return { kind: 'days', days }

  let months = (y - by) * 12 + (m - bm)
  if (d < bd) months -= 1
  if (months >= 12) {
    return {
      kind: 'yearsMonths',
      years: Math.floor(months / 12),
      months: months % 12,
    }
  }
  // 개월 기념일. 생일 일자가 없는 달(1월 31일 → 4월)은 그 달 말일.
  const am = bm + months
  const lastDay = new Date(Date.UTC(by, am, 0)).getUTCDate()
  const anniversary = utcDay(by, am, Math.min(bd, lastDay))
  return { kind: 'monthsDays', months, days: utcDay(y, m, d) - anniversary }
}

export function formatAge(t: TFunction, age: Age): string {
  switch (age.kind) {
    case 'days':
      return t('age.days', { days: age.days })
    case 'monthsDays':
      return t('age.monthsDays', { months: age.months, days: age.days })
    case 'yearsMonths':
      return t('age.yearsMonths', { years: age.years, months: age.months })
  }
}
