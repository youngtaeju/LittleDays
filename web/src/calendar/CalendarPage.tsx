import { getRouteApi, Navigate } from '@tanstack/react-router'
import IconDropDown from '~icons/material-symbols/arrow-drop-down-rounded'
import IconPrev from '~icons/material-symbols/chevron-left-rounded'
import IconNext from '~icons/material-symbols/chevron-right-rounded'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DaySummary } from '@/api/types'
import { Button } from '@/components/ui/button'
import { BabyChips } from '@/feed/BabyChips'
import { errorMessage } from '@/i18n'
import { formatMonth } from '@/lib/dates'
import { useSettings, useToday } from '@/settings/useSettings'
import { useBabies } from '@/timeline/useBabies'
import { useSwipe } from '@/viewer/useSwipe'
import { DayPreview } from './DayPreview'
import { addMonths, defaultDate } from './month'
import { MonthGrid } from './MonthGrid'
import { MonthPickerSheet } from './MonthPickerSheet'
import { useMonth } from './useMonth'

const route = getRouteApi('/authed/shell/calendar')

const NO_DAYS: DaySummary[] = []

// 달력. 달, 고른 날, 아기는 주소(뒤로 오면 같은 칸). 휴대폰은 달력 아래, 데스크톱은 오른쪽에 미리보기.
// 형식 검사는 라우트, 이번 달 이후 검사는 인스턴스 오늘을 아는 화면에서.
export function CalendarPage() {
  const { t, i18n } = useTranslation()
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const settings = useSettings()
  const today = useToday()
  const thisMonth = today.slice(0, 7)
  const { baby } = search
  const future = search.month !== undefined && search.month > thisMonth
  const month = search.month && !future ? search.month : thisMonth
  const query = useMonth(month, baby)
  const days = query.data?.items ?? NO_DAYS
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days])
  const babies = useBabies().data
  const [picking, setPicking] = useState(false)

  // 달 밖, 미래 날짜는 무시.
  const requested =
    search.date?.slice(0, 7) === month && search.date <= today
      ? search.date
      : undefined
  const selected = requested ?? defaultDate(month, today, days)

  const goMonth = useCallback(
    (m: string) => {
      void navigate({
        search: { baby, month: m === thisMonth ? undefined : m },
        replace: true,
      })
    },
    [navigate, baby, thisMonth],
  )
  const canNext = month < thisMonth

  const onSelect = useCallback(
    (date: string) => {
      if (date === selected) {
        void navigate({ to: '/days/$date', params: { date }, search: { baby } })
      } else {
        void navigate({ search: (s) => ({ ...s, date }), replace: true })
      }
    },
    [navigate, selected, baby],
  )

  // 칸이 전부 버튼이라 시작 제외 없음. 밀고 난 뒤 따라오는 클릭은 칸 고르기로 쓰지 않음.
  const swiped = useRef(false)
  const swipe = useSwipe({
    enabled: true,
    ignore: () => false,
    onLeft: () => {
      if (!canNext) return
      swiped.current = true
      goMonth(addMonths(month, 1))
    },
    onRight: () => {
      swiped.current = true
      goMonth(addMonths(month, -1))
    },
  })

  // 설정 조회 전 오늘은 브라우저 시간대라 판단 보류.
  if (future && settings) return <Navigate to="/calendar" replace />

  const title = formatMonth(month, i18n.language)
  const totals = days.reduce(
    (acc, d) => ({
      photos: acc.photos + d.photo_count,
      videos: acc.videos + d.video_count,
    }),
    { photos: 0, videos: 0 },
  )
  const totalLine = [
    totals.photos > 0
      ? t('calendar.totalPhotos', { count: totals.photos })
      : null,
    totals.videos > 0
      ? t('calendar.totalVideos', { count: totals.videos })
      : null,
    days.length > 0 ? t('calendar.totalDays', { count: days.length }) : null,
  ]
    .filter((v) => v != null)
    .join(' · ')
  const showChips =
    babies &&
    (babies.length >= 2 || (baby && !babies.some((b) => b.id === baby)))

  return (
    <div className="mx-auto max-w-[960px] lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-8">
      <div>
        <div className="flex h-14 items-center justify-between gap-2">
          <h1 className="min-w-0 text-xl font-bold tabular-nums">
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => {
                setPicking(true)
              }}
              className="inline-flex min-h-11 items-center gap-0.5 rounded-lg"
            >
              {title}
              <IconDropDown aria-hidden className="size-6" />
            </button>
          </h1>
          <div className="flex shrink-0">
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('calendar.prevMonth')}
              onClick={() => {
                goMonth(addMonths(month, -1))
              }}
            >
              <IconPrev aria-hidden className="size-6" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('calendar.nextMonth')}
              disabled={!canNext}
              onClick={() => {
                goMonth(addMonths(month, 1))
              }}
            >
              <IconNext aria-hidden className="size-6" />
            </Button>
          </div>
        </div>
        {showChips && (
          <div className="pb-2">
            <BabyChips
              babies={babies}
              selected={baby}
              onSelect={(id) => {
                void navigate({
                  search: (s) => ({ ...s, baby: id }),
                  replace: true,
                })
              }}
            />
          </div>
        )}
        <div
          {...swipe}
          onPointerDownCapture={() => {
            swiped.current = false
          }}
          onClickCapture={(e) => {
            // 키보드 클릭(detail 0)은 남은 플래그와 무관하게 통과.
            if (!swiped.current || e.detail === 0) return
            swiped.current = false
            e.preventDefault()
            e.stopPropagation()
          }}
          className="-mx-3 touch-pan-y select-none lg:mx-0"
        >
          <MonthGrid
            month={month}
            label={title}
            days={byDate}
            today={today}
            selected={selected}
            onSelect={onSelect}
          />
        </div>
        {totalLine && (
          <p className="pt-3 text-sm text-muted-foreground tabular-nums">
            {totalLine}
          </p>
        )}
        {query.isError && (
          <div className="grid justify-items-start gap-3 py-4">
            <p className="text-sm">{errorMessage(t, query.error)}</p>
            <Button variant="outline" onClick={() => void query.refetch()}>
              {t('common.retry')}
            </Button>
          </div>
        )}
      </div>
      {selected && query.isSuccess && (
        <div className="mt-4 border-t pt-2 lg:sticky lg:top-4 lg:mt-0 lg:border-t-0 lg:pt-0">
          <DayPreview
            date={selected}
            day={byDate.get(selected)}
            baby={baby}
            timezone={settings?.timezone}
          />
        </div>
      )}
      {picking && (
        <MonthPickerSheet
          month={month}
          thisMonth={thisMonth}
          onPick={(m) => {
            setPicking(false)
            goMonth(m)
          }}
          onClose={() => {
            setPicking(false)
          }}
        />
      )}
    </div>
  )
}
