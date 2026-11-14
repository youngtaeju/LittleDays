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
  // 생후 N일은 태어난 날 = 1(dayNumber 와 동일). 0 기준 100일부터 개월 표기.
  if (days < 100) return { kind: 'days', days: days + 1 }

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

// 생일 전이면 남은 일수.
export function dueIn(birthDate: string, date: string): number | null {
  const [by, bm, bd] = parts(birthDate)
  const [y, m, d] = parts(date)
  const left = utcDay(by, bm, bd) - utcDay(y, m, d)
  return left > 0 ? left : null
}

// 태어난 날 = 1일째(한국 관례). D+ 와 100·200·300일 기준.
export function dayNumber(birthDate: string, date: string): number {
  const [by, bm, bd] = parts(birthDate)
  const [y, m, d] = parts(date)
  return utcDay(y, m, d) - utcDay(by, bm, bd) + 1
}

export type SpecialDay =
  { kind: 'days'; n: 100 | 200 | 300 } | { kind: 'birthday'; n: number }

const SPECIAL_DAYS = [100, 200, 300] as const

// n번째 생일 날짜. 2월 29일생은 평년 2월 28일(개월 기념일과 같은 말일 보정).
function birthdayDay(by: number, bm: number, bd: number, n: number): number {
  return anniversary(by, bm, bd, n * 12)
}

export function specialDay(birthDate: string, date: string): SpecialDay | null {
  const [by, bm, bd] = parts(birthDate)
  const [y, m, d] = parts(date)
  const today = utcDay(y, m, d)
  const num = dayNumber(birthDate, date)
  for (const n of SPECIAL_DAYS) if (num === n) return { kind: 'days', n }
  const n = y - by
  if (n >= 1 && birthdayDay(by, bm, bd, n) === today)
    return { kind: 'birthday', n }
  return null
}

// 오늘 이후(오늘 제외) 가장 가까운 기념일. 출생 전이면 null.
export function nextAnniversary(
  birthDate: string,
  today: string,
): { day: SpecialDay; inDays: number } | null {
  const [by, bm, bd] = parts(birthDate)
  const [y, m, d] = parts(today)
  const now = utcDay(y, m, d)
  const born = utcDay(by, bm, bd)
  if (now < born) return null

  const candidates: { day: SpecialDay; at: number }[] = SPECIAL_DAYS.map(
    (n) => ({ day: { kind: 'days', n }, at: born + n - 1 }),
  )
  const n = Math.max(1, y - by)
  for (const k of [n, n + 1])
    candidates.push({
      day: { kind: 'birthday', n: k },
      at: birthdayDay(by, bm, bd, k),
    })
  let best: { day: SpecialDay; at: number } | null = null
  for (const c of candidates)
    if (c.at > now && (best === null || c.at < best.at)) best = c
  return best && { day: best.day, inDays: best.at - now }
}

export function formatAge(t: TFunction, age: Age): string {
  switch (age.kind) {
    case 'days':
      return t('age.days', { days: age.days })
    case 'monthsDays':
      if (age.days === 0) return t('age.months', { months: age.months })
      return t('age.monthsDays', { months: age.months, days: age.days })
    case 'yearsMonths':
      return t('age.yearsMonths', { years: age.years, months: age.months })
  }
}

export function formatAgeLine(
  t: TFunction,
  birthDate: string,
  date: string,
): string {
  const due = dueIn(birthDate, date)
  if (due !== null) return t('age.due', { n: due })
  const age = ageAt(birthDate, date)
  return age ? formatAge(t, age) : ''
}

function enOrdinal(n: number): string {
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) return String(n) + 'th'
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'
  return String(n) + suffix
}

// 1~10 은 서수 단어 키(age.birthdayWord.N), 그 외는 일반 형식.
export function formatSpecialDay(t: TFunction, day: SpecialDay): string {
  if (day.kind === 'days') return t('age.specialDays', { n: day.n })
  return t(`age.birthdayWord.${String(day.n)}`, {
    defaultValue: t('age.birthdayN', { n: day.n, ordinal: enOrdinal(day.n) }),
  })
}

export function formatNextAnniversary(
  t: TFunction,
  next: { day: SpecialDay; inDays: number },
): string {
  return t('age.until', {
    label: formatSpecialDay(t, next.day),
    n: next.inDays,
  })
}
