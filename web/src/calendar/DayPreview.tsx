import { Link } from '@tanstack/react-router'
import IconChevron from '~icons/material-symbols/chevron-right-rounded'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { DaySummary } from '@/api/types'
import { milestonesText } from '@/feed/dayMeta'
import { Mosaic } from '@/feed/Mosaic'
import { formatDay } from '@/lib/dates'
import { useUsers } from '@/members/useUsers'
import { MentionText } from '@/stories/StoryBlock'

// 고른 날 미리보기. 날짜와 마일스톤, 모자이크(최대 3장), 첫 이야기 첫 줄, 그날 보기.
// day 없음 = 기록 없는 날. 날짜와 그날 보기는 그날 화면, 사진은 뷰어.
export function DayPreview({
  date,
  day,
  baby,
  timezone,
}: {
  date: string
  day: DaySummary | undefined
  baby: string | undefined
  timezone: string | undefined
}) {
  const { t, i18n } = useTranslation()
  const users = useUsers().data?.users ?? []
  const headingId = useId()
  const label = formatDay(date, i18n.language)
  const milestones = day ? milestonesText(t, day.milestones) : null
  const story = day?.stories[0]
  const dayLink = {
    to: '/days/$date',
    params: { date },
    search: { baby },
  } as const

  return (
    <section aria-labelledby={headingId} className="grid gap-3">
      <h2
        id={headingId}
        className="flex min-h-11 flex-wrap items-center gap-x-1 text-base font-bold tabular-nums"
      >
        {day ? (
          <Link {...dayLink} className="inline-flex min-h-11 items-center">
            {label}
          </Link>
        ) : (
          label
        )}
        {milestones && (
          <span className="text-xs font-bold wrap-anywhere text-accent-ink">
            {milestones}
          </span>
        )}
      </h2>
      {day ? (
        <>
          <div className="-mx-4 lg:mx-0">
            <Mosaic day={day} label={label} baby={baby} timezone={timezone} />
          </div>
          {story && (
            <p className="truncate border-l-[3px] border-accent-soft pl-2 text-sm">
              <MentionText
                body={story.body.split('\n')[0] ?? ''}
                users={users}
              />
            </p>
          )}
          <Link
            {...dayLink}
            className="inline-flex min-h-11 items-center gap-0.5 justify-self-start text-sm font-semibold text-accent-ink"
          >
            {t('calendar.openDay')}
            <IconChevron aria-hidden className="size-5" />
          </Link>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t('calendar.emptyDay')}
        </p>
      )}
    </section>
  )
}
