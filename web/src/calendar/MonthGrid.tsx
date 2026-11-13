import IconStar from '~icons/material-symbols/star-rounded'
import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { DaySummary } from '@/api/types'
import { milestoneLabel } from '@/milestones/labels'
import { formatMonthDay } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { thumbUrl } from '@/timeline/media'
import { monthCells } from './month'

const weekdayFormats = new Map<string, Intl.DateTimeFormat>()

// 일요일부터 요일 이름. 2026-11-01 = 일요일.
function weekdays(lng: string): string[] {
  let f = weekdayFormats.get(lng)
  if (!f) {
    f = new Intl.DateTimeFormat(lng, { weekday: 'short', timeZone: 'UTC' })
    weekdayFormats.set(lng, f)
  }
  const fmt = f
  return Array.from({ length: 7 }, (_, i) =>
    fmt.format(new Date(Date.UTC(2026, 10, 1 + i))),
  )
}

// 칸 하나. 사진 날 = 대표 사진, 글만 = 점, 마일스톤 = ★. 미래 날은 누를 수 없음.
const DayCell = memo(function DayCell({
  date,
  day,
  today,
  selected,
  onSelect,
}: {
  date: string
  day: DaySummary | undefined
  today: string
  selected: boolean
  onSelect: (date: string) => void
}) {
  const { t, i18n } = useTranslation()
  const future = date > today
  const photo = day?.preview[0]
  const label = [
    formatMonthDay(date, i18n.language),
    day && day.photo_count > 0
      ? t('feed.photos', { count: day.photo_count })
      : null,
    day && day.video_count > 0
      ? t('feed.videos', { count: day.video_count })
      : null,
    day && day.stories.length > 0
      ? t('calendar.stories', { count: day.stories.length })
      : null,
    day && day.milestones.length > 0
      ? t('calendar.milestones', {
          names: day.milestones.map((m) => milestoneLabel(t, m)).join(', '),
        })
      : null,
  ]
    .filter((v) => v != null)
    .join(', ')

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      aria-current={date === today ? 'date' : undefined}
      disabled={future}
      onClick={() => {
        onSelect(date)
      }}
      className="relative aspect-square min-w-0 overflow-hidden rounded-md text-xs tabular-nums"
      style={
        photo?.dominant_color
          ? { backgroundColor: photo.dominant_color }
          : undefined
      }
    >
      {photo && (
        <span aria-hidden className="absolute inset-0 bg-muted">
          {photo.status === 'ready' && (
            <img
              src={thumbUrl(photo.id)}
              alt=""
              loading="lazy"
              decoding="async"
              className="size-full object-cover"
            />
          )}
        </span>
      )}
      <span
        aria-hidden
        className={cn(
          'absolute top-1 left-1.5 font-semibold',
          photo
            ? 'font-bold text-white [text-shadow:0_0_3px_rgb(0_0_0/0.7)]'
            : future && 'text-muted-foreground',
        )}
      >
        {Number(date.slice(8))}
      </span>
      {!photo && day && day.stories.length > 0 && (
        <span
          aria-hidden
          data-testid="story-dot"
          className="absolute bottom-1.5 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-accent-ink"
        />
      )}
      {day && day.milestones.length > 0 && (
        <IconStar
          aria-hidden
          data-testid="milestone-star"
          className={cn(
            'absolute top-0.5 right-0.5 size-3.5',
            photo
              ? 'text-white drop-shadow-[0_0_2px_rgb(0_0_0/0.7)]'
              : 'text-accent-ink',
          )}
        />
      )}
      {date === today && (
        <span
          aria-hidden
          className={cn(
            'absolute rounded-md ring-2 ring-primary ring-inset',
            selected ? 'inset-[3px]' : 'inset-0',
          )}
        />
      )}
      {selected && (
        <span
          aria-hidden
          className="absolute inset-0 rounded-md ring-3 ring-foreground ring-inset"
        />
      )}
    </button>
  )
})

// 일요일 시작 7열. 앞 빈칸은 빈 자리.
export function MonthGrid({
  month,
  label,
  days,
  today,
  selected,
  onSelect,
}: {
  month: string
  label: string
  days: Map<string, DaySummary>
  today: string
  selected: string | undefined
  onSelect: (date: string) => void
}) {
  const { t, i18n } = useTranslation()
  const cells = useMemo(() => monthCells(month), [month])
  return (
    <div>
      <div
        aria-hidden
        className="grid grid-cols-7 gap-[2px] pb-1 text-center text-xs text-muted-foreground"
      >
        {weekdays(i18n.language).map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div
        role="group"
        aria-label={t('calendar.dates', { month: label })}
        className="grid grid-cols-7 gap-[2px]"
      >
        {cells.map((date, i) =>
          date ? (
            <DayCell
              key={date}
              date={date}
              day={days.get(date)}
              today={today}
              selected={date === selected}
              onSelect={onSelect}
            />
          ) : (
            <span key={`lead-${String(i)}`} />
          ),
        )}
      </div>
    </div>
  )
}
