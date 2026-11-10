import { getRouteApi, useCanGoBack, useRouter } from '@tanstack/react-router'
import IconBack from '~icons/material-symbols/arrow-back-rounded'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import type { AgeMonth } from '@/api/types'
import { Button } from '@/components/ui/button'
import { formatDate, formatMonthDay } from '@/lib/dates'
import {
  ageMonthLabel,
  findAgeMonth,
  parseAgeParam,
  useBabyStats,
} from './useBabyStats'

const route = getRouteApi('/authed/shell/babies/$id/age/$age')

// "2026년 10월 26일 ~ 11월 25일". 같은 해면 끝 연도 생략. 생일 전은 "~ 끝".
function formatRange(t: TFunction, lng: string, m: AgeMonth): string {
  if (m.from === null) return t('babies.until', { to: formatDate(m.to, lng) })
  return t('babies.range', {
    from: formatDate(m.from, lng),
    to:
      m.from.slice(0, 4) === m.to.slice(0, 4)
        ? formatMonthDay(m.to, lng)
        : formatDate(m.to, lng),
  })
}

// 개월 앨범 머리글. 셸이 그림(오프라인 배너 위). 뒤로: 기록이 있으면 되돌아가고, 직접 진입이면 아기 화면.
export function AgeAlbumHeader() {
  const { t, i18n } = useTranslation()
  const { id, age } = route.useParams()
  const navigate = route.useNavigate()
  const router = useRouter()
  const canGoBack = useCanGoBack()
  const stats = useBabyStats(id).data
  const ageMonth = parseAgeParam(age)
  const month =
    stats && ageMonth !== null ? findAgeMonth(stats, ageMonth) : undefined

  return (
    <div className="flex min-h-14 items-center gap-1 px-2 py-1">
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('day.back')}
        onClick={() => {
          if (canGoBack) router.history.back()
          else void navigate({ to: '/babies/$id', params: { id } })
        }}
      >
        <IconBack aria-hidden className="size-6" />
      </Button>
      <div className="min-w-0">
        <h1 className="truncate text-lg font-bold tabular-nums">
          {ageMonth !== null && ageMonthLabel(t, ageMonth)}
        </h1>
        {month && (
          <p className="truncate text-sm text-muted-foreground tabular-nums">
            {formatRange(t, i18n.language, month)}
          </p>
        )}
      </div>
    </div>
  )
}
