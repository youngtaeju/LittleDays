import { Link } from '@tanstack/react-router'
import { memo, useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { Baby, DaySummary, User } from '@/api/types'
import { addDays, formatDay } from '@/lib/dates'
import { StoryBlock } from '@/stories/StoryBlock'
import {
  AgeLine,
  ageParts,
  MilestoneLine,
  milestonesText,
  ReactionCounts,
  uploaderNames,
  uploaderText,
} from './dayMeta'
import { Mosaic } from './Mosaic'

// 날짜 머리글(오늘, 어제, 마일스톤), 나이 줄, 모자이크, 올린 사람과 개수 줄, 이야기.
// 사진 없는 날은 머리글 + 이야기, 마일스톤만 있으면 머리글 + 한 줄.
// today: 인스턴스 시간대 오늘(YYYY-MM-DD).
export const DayCard = memo(function DayCard({
  day,
  divided,
  babies,
  users,
  baby,
  today,
  timezone,
}: {
  day: DaySummary
  // 같은 달 앞 카드가 있으면 윗선.
  divided: boolean
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
  const milestones = milestonesText(t, day.milestones)
  const hasMedia = day.photo_count + day.video_count > 0
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
    <article
      aria-labelledby={headingId}
      className={divided ? 'border-t border-border pt-4' : 'pt-4'}
    >
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3">
        <h3 className="min-w-0 text-base font-bold tabular-nums">
          {/* 하루 묶음 이름은 날짜만. */}
          <Link
            {...dayLink}
            id={headingId}
            className="inline-flex min-h-11 items-center"
          >
            {label}
          </Link>
          {milestones && (
            <span className="ml-1 text-xs font-bold wrap-anywhere text-accent-ink">
              {milestones}
            </span>
          )}
        </h3>
        <AgeLine parts={ages} />
      </div>
      {hasMedia && (
        <>
          <div className="-mx-4 sm:mx-0">
            <Mosaic day={day} label={label} baby={baby} timezone={timezone} />
          </div>
          <Link
            {...dayLink}
            className="flex min-h-11 items-center justify-between gap-3 text-xs text-muted-foreground tabular-nums"
          >
            <span className="min-w-0 wrap-anywhere">{meta}</span>
            <ReactionCounts
              likes={day.like_count}
              comments={day.comment_count}
            />
          </Link>
        </>
      )}
      {day.stories.length > 0 ? (
        <div className="grid gap-3 pb-1">
          {day.stories.map((story) => (
            <StoryBlock key={story.id} story={story} compact />
          ))}
        </div>
      ) : (
        !hasMedia && <MilestoneLine day={day} users={users} />
      )}
    </article>
  )
})
