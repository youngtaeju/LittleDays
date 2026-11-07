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

// n개월 기념일. 생일 일자가 없는 달은 그 달 말일(1월 31일 → 4월 30일).
function anniversary(by: number, bm: number, bd: number, n: number): number {
  const lastDay = new Date(Date.UTC(by, bm + n, 0)).getUTCDate()
  return utcDay(by, bm + n, Math.min(bd, lastDay))
}

// 달력 날짜끼리 계산. 시간대 무관.
// 개월 수: 기념일 ≤ date 인 최대 개월. 남은 일수: date − 그 기념일.
export function ageAt(birthDate: string, date: string): Age | null {
  const [by, bm, bd] = parts(birthDate)
  const [y, m, d] = parts(date)
  const today = utcDay(y, m, d)
  const days = today - utcDay(by, bm, bd)
  if (days < 0) return null
  if (days < 100) return { kind: 'days', days }

  // 같은 달 기념일이 아직이면 전달 기념일.
  let months = (y - by) * 12 + (m - bm)
  if (anniversary(by, bm, bd, months) > today) months -= 1
  if (months >= 12) {
    return {
      kind: 'yearsMonths',
      years: Math.floor(months / 12),
      months: months % 12,
    }
  }
  return {
    kind: 'monthsDays',
    months,
    days: today - anniversary(by, bm, bd, months),
  }
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
