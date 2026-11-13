import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { Baby, DaySummary } from '@/api/types'
import { hasRole, useMe } from '@/auth/session'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/i18n'
import { formatMonth } from '@/lib/dates'
import { useUsers } from '@/members/useUsers'
import { useSettings, useToday } from '@/settings/useSettings'
import { useBabies } from '@/timeline/useBabies'
import { useUploadPicker } from '@/upload/picker'
import { DayCard } from './DayCard'
import { useDays, type DaysFilter } from './useDays'

type MonthGroup = { month: string; days: DaySummary[] }

// 조회 전 빈 목록. 매번 새 배열이면 DayCard memo 무효.
const NO_BABIES: Baby[] = []

// 서버 날짜(인스턴스 시간대) 순서 그대로 달마다 묶음.
function byMonth(days: DaySummary[]): MonthGroup[] {
  const months: MonthGroup[] = []
  for (const day of days) {
    const month = day.date.slice(0, 7)
    const last = months.at(-1)
    if (last?.month === month) last.days.push(day)
    else months.push({ month, days: [day] })
  }
  return months
}

function EmptyState({ filtered }: { filtered: boolean }) {
  const { t } = useTranslation()
  const { user } = useMe()
  const picker = useUploadPicker()
  if (filtered) {
    return <p className="py-16 text-center">{t('feed.emptyFiltered')}</p>
  }
  if (!hasRole(user, 'guardian')) {
    return <p className="py-16 text-center">{t('feed.emptyFamily')}</p>
  }
  return (
    <div className="grid justify-items-center gap-2 py-16 text-center">
      <p className="text-base font-semibold">{t('feed.empty')}</p>
      <p className="text-sm text-muted-foreground">{t('feed.emptyHint')}</p>
      <Button
        className="mt-2"
        onClick={() => {
          picker.open()
        }}
      >
        {t('nav.add')}
      </Button>
    </div>
  )
}

// 하루 묶음 최신순 무한 스크롤. 홈·개월 앨범 공용.
export function DayFeed({ filter }: { filter: DaysFilter }) {
  const { t, i18n } = useTranslation()
  const timezone = useSettings()?.timezone
  const babies = useBabies().data ?? NO_BABIES
  const users = useUsers().data?.users
  const {
    days,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    isLoadingError,
    isPlaceholderData,
    status,
    error,
    refetch,
  } = useDays(filter)
  const months = useMemo(() => byMonth(days), [days])
  const today = useToday()

  // 화면 끝 1000px 전부터 다음 페이지. 실패 시 자동 재시도 대신 버튼.
  // 필터 전환 중 이전 목록(placeholder)의 커서로는 요청 안 함.
  const sentinel = useRef<HTMLDivElement>(null)
  const autoLoad =
    hasNextPage &&
    !isFetchingNextPage &&
    !isFetchNextPageError &&
    !isPlaceholderData
  // 이전 목록이 비어 있으면 빈 화면 대신 불러오는 중.
  const loading =
    status === 'pending' || (isPlaceholderData && days.length === 0)
  useEffect(() => {
    const el = sentinel.current
    if (!el || !autoLoad) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void fetchNextPage()
      },
      { rootMargin: '1000px 0px' },
    )
    io.observe(el)
    return () => {
      io.disconnect()
    }
  }, [autoLoad, fetchNextPage])

  return (
    <>
      {loading && (
        <p className="py-4 text-sm text-muted-foreground">
          {t('common.loading')}
        </p>
      )}
      {/* 첫 페이지 실패만. 다음 페이지 실패는 목록 끝, 갱신 실패는 목록 유지. */}
      {isLoadingError && (
        <div className="grid justify-items-start gap-3 py-4">
          <p className="text-sm">{errorMessage(t, error)}</p>
          <Button variant="outline" onClick={() => void refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      )}
      {status === 'success' && !isPlaceholderData && days.length === 0 && (
        <EmptyState filtered={!!filter.baby} />
      )}
      {months.map((month) => (
        <section key={month.month} className="pt-6 first-of-type:pt-0">
          <h2 className="text-lg font-bold tabular-nums">
            {formatMonth(month.month, i18n.language)}
          </h2>
          {month.days.map((day) => (
            <DayCard
              key={day.date}
              day={day}
              babies={babies}
              users={users}
              baby={filter.baby}
              today={today}
              timezone={timezone}
            />
          ))}
        </section>
      ))}
      <div ref={sentinel} />
      {isFetchingNextPage && (
        <p className="py-4 text-center text-sm text-muted-foreground">
          {t('common.loading')}
        </p>
      )}
      {isFetchNextPageError && (
        <div className="grid justify-items-center gap-3 py-4">
          <p className="text-sm">{errorMessage(t, error)}</p>
          <Button variant="outline" onClick={() => void fetchNextPage()}>
            {t('common.retry')}
          </Button>
        </div>
      )}
    </>
  )
}
