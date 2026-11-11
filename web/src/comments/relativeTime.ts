import type { TFunction } from 'i18next'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// 하루 안은 상대 시각, 그 뒤는 날짜(올해가 아니면 연도 포함). 날짜는 기기 시간대 기준.
export function relativeTime(
  iso: string,
  now: Date,
  lang: string,
  t: TFunction,
): string {
  const then = new Date(iso)
  const diff = now.getTime() - then.getTime()
  if (diff < MINUTE) return t('comments.justNow')
  if (diff < HOUR)
    return t('comments.minutesAgo', { count: Math.floor(diff / MINUTE) })
  if (diff < DAY)
    return t('comments.hoursAgo', { count: Math.floor(diff / HOUR) })
  const sameYear = then.getFullYear() === now.getFullYear()
  return new Intl.DateTimeFormat(lang, {
    year: sameYear ? undefined : 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(then)
}
