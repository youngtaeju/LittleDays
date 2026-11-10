import { getRouteApi, Navigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '@/api/errors'
import { Button } from '@/components/ui/button'
import { DayFeed } from '@/feed/DayFeed'
import { errorMessage } from '@/i18n'
import { saveLastBaby } from './lastBaby'
import { findAgeMonth, parseAgeParam, useBabyStats } from './useBabyStats'

const route = getRouteApi('/authed/shell/babies/$id/age/$age')

// 개월 앨범. 홈과 같은 하루 묶음 피드를 이 아기·그 개월 기간으로. 머리글은 셸(AgeAlbumHeader).
export function AgeAlbumPage() {
  const { t } = useTranslation()
  const { id, age } = route.useParams()
  const ageMonth = parseAgeParam(age)
  const stats = useBabyStats(id)

  useEffect(() => {
    if (stats.data) saveLastBaby(id)
  }, [id, stats.data])

  // 지운 아기.
  if (stats.error instanceof ApiError && stats.error.status === 404) {
    return <Navigate to="/babies" replace />
  }
  if (stats.isError && !stats.data) {
    return (
      <div className="grid justify-items-start gap-3 py-4">
        <p className="text-sm">{errorMessage(t, stats.error)}</p>
        <Button variant="outline" onClick={() => void stats.refetch()}>
          {t('common.retry')}
        </Button>
      </div>
    )
  }
  if (!stats.data) {
    return (
      <p className="py-4 text-sm text-muted-foreground">
        {t('common.loading')}
      </p>
    )
  }
  const month =
    ageMonth === null ? undefined : findAgeMonth(stats.data, ageMonth)
  // 사진이 없어진(휴지통 등) 개월.
  if (!month) {
    return <Navigate to="/babies/$id" params={{ id }} replace />
  }
  return (
    <div className="mx-auto max-w-[640px]">
      <DayFeed
        filter={{ baby: id, from: month.from ?? undefined, to: month.to }}
      />
    </div>
  )
}
