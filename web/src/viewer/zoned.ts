// 인스턴스 시간대 기준 시각 변환. 브라우저 시간대 미사용, Intl 만 사용.

const partFormats = new Map<string, Intl.DateTimeFormat>()

function partFormat(tz: string): Intl.DateTimeFormat {
  let f = partFormats.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    partFormats.set(tz, f)
  }
  return f
}

type Wall = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

// t 시각의 tz 벽시계 값.
function wall(t: number, tz: string): Wall {
  const n: Record<string, number> = {}
  for (const p of partFormat(tz).formatToParts(t)) {
    if (p.type !== 'literal') n[p.type] = Number(p.value)
  }
  return {
    year: n.year ?? 0,
    month: n.month ?? 1,
    day: n.day ?? 1,
    hour: n.hour ?? 0,
    minute: n.minute ?? 0,
    second: n.second ?? 0,
  }
}

function pad(v: number, len = 2): string {
  return String(v).padStart(len, '0')
}

function ymd(w: Wall): string {
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}`
}

// 벽시계 값 - 실제 시각(ms). 초 미만은 버림.
function offset(t: number, tz: string): number {
  const w = wall(t, tz)
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second)
  return asUtc - Math.floor(t / 1000) * 1000
}

// 예 "2024년 5월 2일 목요일 오전 1:30".
export function formatInZone(iso: string, tz: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(new Date(iso))
}

// 24시간제 `HH:mm`.
export function formatClock(iso: string, tz: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso))
}

// tz 기준 오늘 `YYYY-MM-DD`.
export function todayInZone(tz: string, now: Date = new Date()): string {
  return ymd(wall(now.getTime(), tz))
}

// `datetime-local` 값 `YYYY-MM-DDTHH:mm`.
export function toZonedInput(iso: string, tz: string): string {
  const w = wall(new Date(iso).getTime(), tz)
  return `${ymd(w)}T${pad(w.hour)}:${pad(w.minute)}`
}

// `datetime-local` 값 → ISO UTC. DST 경계 1회 보정.
export function fromZonedInput(local: string, tz: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local)
  if (!m) throw new RangeError(`datetime-local 형식 아님: ${local}`)
  const [, y, mo, d, h, mi, s] = m.map(Number)
  const t0 = Date.UTC(y ?? 0, (mo ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0, s || 0)
  const o1 = offset(t0, tz)
  const t1 = t0 - o1
  const o2 = offset(t1, tz)
  return new Date(o2 !== o1 ? t0 - o2 : t1).toISOString()
}
