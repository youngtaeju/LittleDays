import { Link } from '@tanstack/react-router'
import { memo, useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { Baby, DaySummary, User } from '@/api/types'
import { addDays, formatDay } from '@/lib/dates'
import {
  AgeLine,
  ageParts,
  ReactionCounts,
  uploaderNames,
  uploaderText,
} from './dayMeta'
import { Mosaic } from './Mosaic'

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
  const names = uploaderNames(users, day.uploader_ids)
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
        <AgeLine parts={ages} />
      </div>
      <div className="-mx-4 sm:mx-0">
        <Mosaic day={day} label={label} baby={baby} timezone={timezone} />
      </div>
      <Link
        {...dayLink}
        className="flex min-h-11 items-center justify-between gap-3 text-xs text-muted-foreground tabular-nums"
      >
        <span className="min-w-0 wrap-anywhere">{meta}</span>
        <ReactionCounts likes={day.like_count} comments={day.comment_count} />
      </Link>
    </article>
  )
})
