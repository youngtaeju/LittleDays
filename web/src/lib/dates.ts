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

// YYYY-MM-DD 달력 날짜 더하기.
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
