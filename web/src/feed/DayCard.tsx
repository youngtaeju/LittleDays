import { Link } from '@tanstack/react-router'
import type { TFunction } from 'i18next'
import { Fragment, memo, useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { Baby, DaySummary, User } from '@/api/types'
import { formatAgeLine, formatSpecialDay, specialDay } from '@/lib/age'
import { addDays, formatDay } from '@/lib/dates'
import { Mosaic } from './Mosaic'

// 이름 끝 글자 받침으로 이/가 고르기(i18n context). 한글이 아니면 판단 불가.
function josa(name: string): 'batchim' | 'unknown' | undefined {
  const code = name.charCodeAt(name.length - 1)
  if (code < 0xac00 || code > 0xd7a3) return 'unknown'
  return (code - 0xac00) % 28 ? 'batchim' : undefined
}

function uploaderText(t: TFunction, names: string[]): string | null {
  const [first, second] = names
  if (!first) return null
  if (names.length >= 3) {
    return t('feed.uploadedByMany', { name: first, count: names.length - 1 })
  }
  if (!second) {
    return t('feed.uploadedBy', { name: first, context: josa(first) })
  }
  return t('feed.uploadedBy', {
    name: t('feed.pair', { a: first, b: second }),
    context: josa(second),
  })
}

type AgePart = { text: string; special: boolean }

// 필터 아기, 아기가 1명이면 그 아기, 아니면 그날 태그된 아기 전부(아기 순서).
// 특별한 날은 나이 대신 배지.
function ageParts(
  t: TFunction,
  day: DaySummary,
  babies: Baby[],
  filter: string | undefined,
): AgePart[] {
  const targets = filter
    ? babies.filter((b) => b.id === filter)
    : babies.length === 1
      ? babies
      : babies.filter((b) => day.baby_ids.includes(b.id))
  // 여러 아기 중 누구 나이인지 이름 표시.
  const named = !filter && babies.length > 1
  return targets.flatMap((b) => {
    const special = specialDay(b.birth_date, day.date)
    const text = special
      ? formatSpecialDay(t, special)
      : formatAgeLine(t, b.birth_date, day.date)
    if (!text) return []
    return [{ text: named ? `${b.name} ${text}` : text, special: !!special }]
  })
}

// 날짜 머리글(오늘·어제), 나이 줄, 모자이크, 올린 사람·개수 줄.
// today: 인스턴스 시간대 오늘(YYYY-MM-DD).
export const DayCard = memo(function DayCard({
  day,
  babies,
  users,
  baby,
  today,
  timezone,
}: {
  day: DaySummary
  babies: Baby[]
  users: User[] | undefined
  baby: string | undefined
  today: string
  timezone: string | undefined
}) {
  const { t, i18n } = useTranslation()
  const headingId = useId()
  const label =
    day.date === today
      ? t('feed.today')
      : day.date === addDays(today, -1)
        ? t('feed.yesterday')
        : formatDay(day.date, i18n.language)
  const ages = ageParts(t, day, babies, baby)
  // 멤버 목록 순서. 모르는 사용자(삭제 등)는 생략.
  const names = (users ?? [])
    .filter((u) => day.uploader_ids.includes(u.id))
    .map((u) => u.display_name)
  const meta = [
    uploaderText(t, names),
    day.photo_count > 0 ? t('feed.photos', { count: day.photo_count }) : null,
    day.video_count > 0 ? t('feed.videos', { count: day.video_count }) : null,
  ]
    .filter((v) => v != null)
    .join(' · ')
  const dayLink = {
    to: '/days/$date',
    params: { date: day.date },
    search: { baby },
  } as const

  return (
    <article aria-labelledby={headingId} className="pt-4">
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3">
        <h3 id={headingId} className="text-base font-bold tabular-nums">
          <Link {...dayLink} className="inline-flex min-h-11 items-center">
            {label}
          </Link>
        </h3>
        {ages.length > 0 && (
          <p className="text-xs wrap-anywhere text-muted-foreground tabular-nums">
            {ages.map((a, i) => (
              <Fragment key={a.text}>
                {i > 0 && ' · '}
                {a.special ? (
                  <span className="rounded-full bg-accent-soft px-2 py-0.5 font-semibold text-accent-ink">
                    {a.text}
                  </span>
                ) : (
                  a.text
                )}
              </Fragment>
            ))}
          </p>
        )}
      </div>
      <div className="-mx-4 sm:mx-0">
        <Mosaic day={day} label={label} baby={baby} timezone={timezone} />
      </div>
      <Link
        {...dayLink}
        className="flex min-h-11 items-center text-xs wrap-anywhere text-muted-foreground tabular-nums"
      >
        {meta}
      </Link>
    </article>
  )
})
