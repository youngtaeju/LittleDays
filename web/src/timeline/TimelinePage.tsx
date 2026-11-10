import { getRouteApi } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import type { AssetSummary, Baby } from '@/api/types'
import { hasRole, useMe } from '@/auth/session'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/i18n'
import { useSettings } from '@/settings/useSettings'
import { useUploadPicker } from '@/upload/picker'
import { ageAt, formatAge } from './age'
import { BabyFilter } from './BabyFilter'
import {
  formatDay,
  formatMonth,
  groupByLocalDate,
  type DayGroup,
} from './group'
import { Tile } from './Tile'
import { useBabies } from './useBabies'
import { useProcessingPoll, useTimeline } from './useTimeline'

const route = getRouteApi('/authed/shell/')

// 필터 아기, 아기가 1명이면 그 아기, 아니면 그날 태그된 아기 sort_order 순 최대 2명.
function ageTargets(
  day: DayGroup,
  babies: Baby[],
  filter: string | undefined,
): Baby[] {
  if (filter) return babies.filter((b) => b.id === filter)
  if (babies.length === 1) return babies
  const tagged = new Set(day.items.flatMap((i) => i.baby_ids))
  return babies.filter((b) => tagged.has(b.id)).slice(0, 2)
}

function DayHeader({
  day,
  babies,
  filter,
}: {
  day: DayGroup
  babies: Baby[]
  filter: string | undefined
}) {
  const { t, i18n } = useTranslation()
  // 필터 없이 아기가 여럿이면 누구 나이인지 이름 표시.
  const named = !filter && babies.length > 1
  const ages = ageTargets(day, babies, filter).flatMap((b) => {
    const age = ageAt(b.birth_date, day.date)
    if (!age) return []
    const text = formatAge(t, age)
    return [named ? `${b.name} ${text}` : text]
  })
  return (
    <div className="mt-4 mb-2">
      <h3 className="text-lg font-semibold tabular-nums">
        {formatDay(day.date, i18n.language)}
      </h3>
      {ages.length > 0 && (
        <p className="text-sm text-muted-foreground tabular-nums">
          {ages.join(' · ')}
        </p>
      )}
    </div>
  )
}

// 처리 중 항목 폴링만 담당. 타일과 형제라 처리 완료 시 타일(Link)이 다시 마운트되지 않음(포커스 유지).
function ProcessingPoll({
  item,
  target,
}: {
  item: AssetSummary
  target: RefObject<HTMLElement | null>
}) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = target.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        const last = entries.at(-1)
        if (last) setVisible(last.isIntersecting)
      },
      { rootMargin: '200px 0px' },
    )
    io.observe(el)
    return () => {
      io.disconnect()
    }
  }, [target])
  useProcessingPoll(item, visible)
  return null
}

function TileItem({
  item,
  baby,
  timezone,
}: {
  item: AssetSummary
  baby: string | undefined
  timezone: string | undefined
}) {
  const ref = useRef<HTMLLIElement>(null)
  return (
    <li ref={ref}>
      <Tile item={item} baby={baby} timezone={timezone} />
      {item.status === 'processing' && (
        <ProcessingPoll item={item} target={ref} />
      )}
    </li>
  )
}

export function TimelinePage() {
  const { t, i18n } = useTranslation()
  const { baby } = route.useSearch()
  const timezone = useSettings()?.timezone
  const { user } = useMe()
  const picker = useUploadPicker()
  const babies = useBabies().data ?? []
  const {
    items,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    isLoadingError,
    isPlaceholderData,
    status,
    error,
    refetch,
  } = useTimeline(baby)
  const months = useMemo(() => groupByLocalDate(items), [items])

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
    status === 'pending' || (isPlaceholderData && items.length === 0)
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
      <h1 className="sr-only">{t('nav.home')}</h1>
      <BabyFilter babies={babies} selected={baby} />
      {loading && (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      )}
      {/* 첫 페이지 실패만. 다음 페이지 실패는 목록 끝, 갱신 실패는 목록 유지. */}
      {isLoadingError && (
        <div className="grid justify-items-start gap-3">
          <p className="text-sm">{errorMessage(t, error)}</p>
          <Button variant="outline" onClick={() => void refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      )}
      {status !== 'pending' &&
        !isLoadingError &&
        !isPlaceholderData &&
        items.length === 0 && (
          <div className="grid justify-items-center gap-4 py-16 text-center">
            <p className="text-base">
              {baby ? t('timeline.emptyFiltered') : t('timeline.empty')}
            </p>
            {!baby && hasRole(user, 'guardian') && (
              <Button onClick={picker.open}>{t('timeline.upload')}</Button>
            )}
          </div>
        )}
      {months.map((month) => (
        <section key={month.month} className="mt-8 first-of-type:mt-0">
          <h2 className="text-xl font-semibold tabular-nums">
            {formatMonth(month.month, i18n.language)}
          </h2>
          {month.days.map((day) => (
            <div key={day.date}>
              <DayHeader day={day} babies={babies} filter={baby} />
              <ul className="-mx-4 grid grid-cols-3 gap-[2px] sm:mx-0 sm:grid-cols-4 lg:grid-cols-6">
                {day.items.map((item) => (
                  <TileItem
                    key={item.id}
                    item={item}
                    baby={baby}
                    timezone={timezone}
                  />
                ))}
              </ul>
            </div>
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
