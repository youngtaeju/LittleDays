const dayFormats = new Map<string, Intl.DateTimeFormat>()
const dayYearFormats = new Map<string, Intl.DateTimeFormat>()
const monthFormats = new Map<string, Intl.DateTimeFormat>()
const dateFormats = new Map<string, Intl.DateTimeFormat>()
const monthDayFormats = new Map<string, Intl.DateTimeFormat>()

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

// "2023년 5월 2일 화요일" / "Tuesday, May 2, 2023". 올해가 아닌 날 제목용.
export function formatDayWithYear(date: string, lng: string): string {
  return cached(dayYearFormats, lng, {
    year: 'numeric',
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

// "2025년 9월 26일" / "September 26, 2025".
export function formatDate(date: string, lng: string): string {
  return cached(dateFormats, lng, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(`${date}T00:00:00Z`))
}

// "11월 25일" / "November 25". 기간 끝처럼 연도가 앞에서 나온 경우.
export function formatMonthDay(date: string, lng: string): string {
  return cached(monthDayFormats, lng, {
    month: 'long',
    day: 'numeric',
  }).format(new Date(`${date}T00:00:00Z`))
}

// 올해면 "11월 3일", 아니면 연도까지. today 는 인스턴스 오늘.
export function formatShortDate(
  date: string,
  today: string,
  lng: string,
): string {
  return date.slice(0, 4) === today.slice(0, 4)
    ? formatMonthDay(date, lng)
    : formatDate(date, lng)
}

// YYYY-MM-DD 달력 날짜 더하기.
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// YYYY-MM-DD 형식이면서 실제 존재하는 달력 날짜.
export function isCalendarDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}
