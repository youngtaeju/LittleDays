import { getRouteApi, useCanGoBack, useRouter } from '@tanstack/react-router'
import IconBack from '~icons/material-symbols/arrow-back-rounded'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { formatDay, formatDayWithYear } from '@/lib/dates'
import { useToday } from '@/settings/useSettings'
import { useBabies } from '@/timeline/useBabies'
import { AgeLine, ageParts, milestonesText, ReactionCounts } from './dayMeta'
import { useDay } from './useDay'

const route = getRouteApi('/authed/shell/days/$date')

// 그날 화면 머리글. 셸이 그림(오프라인 배너 위). 날짜 옆 마일스톤.
// 뒤로: 기록이 있으면 되돌아가고, 직접 진입이면 홈.
export function DayHeader() {
  const { t, i18n } = useTranslation()
  const { date } = route.useParams()
  const { baby } = route.useSearch()
  const navigate = route.useNavigate()
  const router = useRouter()
  const canGoBack = useCanGoBack()
  const today = useToday()
  const day = useDay(date, baby).data
  const babies = useBabies().data
  const ages = day && babies ? ageParts(t, day, babies, baby) : []
  const milestones = day ? milestonesText(t, day.milestones) : null
  const counts = day
    ? [
        day.photo_count > 0
          ? t('feed.photos', { count: day.photo_count })
          : null,
        day.video_count > 0
          ? t('feed.videos', { count: day.video_count })
          : null,
      ]
        .filter((v) => v != null)
        .join(' · ')
    : undefined

  return (
    <div className="flex min-h-14 items-center gap-1 px-2 py-1">
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('day.back')}
        onClick={() => {
          if (canGoBack) router.history.back()
          else void navigate({ to: '/', search: { baby } })
        }}
      >
        <IconBack aria-hidden className="size-6" />
      </Button>
      <div className="min-w-0">
        <div className="flex min-w-0 items-baseline gap-1">
          <h1 className="min-w-0 truncate text-xl font-bold tabular-nums">
            {date.slice(0, 4) === today.slice(0, 4)
              ? formatDay(date, i18n.language)
              : formatDayWithYear(date, i18n.language)}
          </h1>
          {milestones && (
            // 좁으면 날짜 우선.
            <p className="min-w-0 flex-1 truncate text-sm font-bold text-accent-ink">
              {milestones}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3">
          <AgeLine parts={ages} suffix={counts} className="text-sm" />
          {day && (
            <ReactionCounts
              likes={day.like_count}
              comments={day.comment_count}
              className="text-sm"
            />
          )}
        </div>
      </div>
    </div>
  )
}
