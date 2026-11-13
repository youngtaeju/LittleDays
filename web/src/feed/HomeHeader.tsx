import { getRouteApi, Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Avatar } from '@/babies/Avatar'
import { dayNumber, dueIn } from '@/lib/age'
import { useToday } from '@/settings/useSettings'
import { useBabies } from '@/timeline/useBabies'
import { BabyChips } from './BabyChips'

const route = getRouteApi('/authed/shell/')

// 태어난 날 = D+1. 출산 전이면 D-남은 일수.
function DayBadge({ birthDate, today }: { birthDate: string; today: string }) {
  const { t } = useTranslation()
  const due = dueIn(birthDate, today)
  return (
    <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent-ink tabular-nums">
      {due === null
        ? t('feed.dPlus', { n: dayNumber(birthDate, today) })
        : t('feed.dMinus', { n: due })}
    </span>
  )
}

// 아기 1명: 아바타 + 이름 + D 배지. 2명 이상: 우리 집 이름 + 아기 칩, 칩으로 고른 아기는 아바타 + 이름 + 배지.
// 아바타와 이름은 아기 화면 링크.
export function HomeHeader({ instanceName }: { instanceName?: string }) {
  const { baby } = route.useSearch()
  const babiesQuery = useBabies()
  const babies = babiesQuery.data
  const today = useToday()
  const single = babies?.length === 1 ? babies[0] : undefined
  const target = single ?? babies?.find((b) => b.id === baby)
  return (
    <div className="px-4">
      <div className="flex h-14 items-center gap-2">
        {target ? (
          <Link
            to="/babies/$id"
            params={{ id: target.id }}
            className="flex min-h-11 min-w-0 items-center gap-2 rounded-lg"
          >
            <Avatar
              baby={target}
              size={32}
              className="ring-2 ring-accent-soft ring-offset-2 ring-offset-background"
            />
            <span className="min-w-0 truncate text-lg font-bold">
              {target.name}
            </span>
          </Link>
        ) : (
          <p className="min-w-0 truncate text-lg font-bold">
            {/* 조회 전은 비움(우리 집 이름 → 아기 이름 깜빡임 방지). 조회 실패(오프라인 첫 진입)는 우리 집 이름. */}
            {(babies || babiesQuery.isError) && instanceName}
          </p>
        )}
        {target && <DayBadge birthDate={target.birth_date} today={today} />}
      </div>
      {babies &&
        (babies.length >= 2 ||
          (baby && !babies.some((b) => b.id === baby))) && (
          <BabyChips babies={babies} selected={baby} />
        )}
    </div>
  )
}
