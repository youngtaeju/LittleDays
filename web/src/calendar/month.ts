import type { DaySummary } from '@/api/types'

// YYYY-MM, 월 01~12.
export function isMonth(v: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(v)
}

// 연 0~99 를 1900년대로 바꾸는 Date.UTC 대신 setUTCFullYear.
function utcDate(year: number, monthIndex: number, day: number): Date {
  const d = new Date(0)
  d.setUTCFullYear(year, monthIndex, day)
  return d
}

function parts(month: string): [number, number] {
  return [Number(month.slice(0, 4)), Number(month.slice(5, 7))]
}

export function addMonths(month: string, n: number): string {
  const [y, m] = parts(month)
  return utcDate(y, m - 1 + n, 1)
    .toISOString()
    .slice(0, 7)
}

function daysIn(month: string): number {
  const [y, m] = parts(month)
  return utcDate(y, m, 0).getUTCDate()
}

export function monthRange(month: string): { from: string; to: string } {
  return {
    from: `${month}-01`,
    to: `${month}-${String(daysIn(month)).padStart(2, '0')}`,
  }
}

// 일요일 시작. 앞 빈칸 null, 뒤 빈칸 없음(최대 6주).
export function monthCells(month: string): (string | null)[] {
  const [y, m] = parts(month)
  const lead = utcDate(y, m - 1, 1).getUTCDay()
  const dates = Array.from(
    { length: daysIn(month) },
    (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`,
  )
  return [...Array<null>(lead).fill(null), ...dates]
}

// 이번 달이면 오늘, 아니면 그 달 마지막 기록한 날, 기록 없으면 없음.
export function defaultDate(
  month: string,
  today: string,
  days: DaySummary[],
): string | undefined {
  if (today.slice(0, 7) === month) return today
  let last: string | undefined
  for (const d of days) {
    if (d.date.slice(0, 7) === month && (!last || d.date > last)) last = d.date
  }
  return last
}
