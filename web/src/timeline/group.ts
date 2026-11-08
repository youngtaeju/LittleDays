import type { AssetSummary } from '@/api/types'

export type DayGroup = { date: string; items: AssetSummary[] }
export type MonthGroup = { month: string; days: DayGroup[] }

// 서버 local_date(인스턴스 시간대)만 사용. 브라우저 시간대로 재계산 안 함.
export function groupByLocalDate(items: AssetSummary[]): MonthGroup[] {
  const months: MonthGroup[] = []
  const monthIndex = new Map<string, MonthGroup>()
  const dayIndex = new Map<string, DayGroup>()
  for (const item of items) {
    let day = dayIndex.get(item.local_date)
    if (!day) {
      const key = item.local_date.slice(0, 7)
      let month = monthIndex.get(key)
      if (!month) {
        month = { month: key, days: [] }
        monthIndex.set(key, month)
        months.push(month)
      }
      day = { date: item.local_date, items: [] }
      dayIndex.set(item.local_date, day)
      month.days.push(day)
    }
    day.items.push(item)
  }
  return months
}

const dayFormats = new Map<string, Intl.DateTimeFormat>()
const monthFormats = new Map<string, Intl.DateTimeFormat>()

function cached(
  cache: Map<string, Intl.DateTimeFormat>,
  lng: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  let f = cache.get(lng)
  if (!f) {
    // 달력 날짜를 UTC 자정으로 두고 UTC 로 표시. 시간대 이동 없음.
    f = new Intl.DateTimeFormat(lng, { ...options, timeZone: 'UTC' })
    cache.set(lng, f)
  }
  return f
}

// "5월 2일 목요일" / "Thursday, May 2".
export function formatDay(date: string, lng: string): string {
  return cached(dayFormats, lng, {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date(`${date}T00:00:00Z`))
}

// "2024년 5월" / "May 2024". month 는 YYYY-MM.
export function formatMonth(month: string, lng: string): string {
  return cached(monthFormats, lng, { year: 'numeric', month: 'long' }).format(
    new Date(`${month}-01T00:00:00Z`),
  )
}
