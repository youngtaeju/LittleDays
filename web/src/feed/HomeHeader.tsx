import { getRouteApi, Link } from '@tanstack/react-router'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { Baby } from '@/api/types'
import { Avatar } from '@/babies/Avatar'
import { usePrimaryBaby } from '@/babies/usePrimaryBaby'
import { dayNumber, dueIn } from '@/lib/age'
import { useToday } from '@/settings/useSettings'
import { useBabies } from '@/timeline/useBabies'
import { BabyChips } from './BabyChips'

const route = getRouteApi('/authed/shell/')

// 태어난 날 = D+1. 출산 전이면 D-남은 일수.
function DayBadge({
  id,
  birthDate,
  today,
}: {
  id: string
  birthDate: string
  today: string
}) {
  const { t } = useTranslation()
  const due = dueIn(birthDate, today)
  return (
    <span
      id={id}
      className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-2xs font-semibold text-accent-ink tabular-nums"
    >
      {due === null
        ? t('feed.dPlus', { n: dayNumber(birthDate, today) })
        : t('feed.dMinus', { n: due })}
    </span>
  )
}

// 아기 화면 링크. 접근성 이름은 아기 이름, 배지는 설명.
// 줄어들지 않고 머리글 폭 65% 까지. 남는 폭은 우리 집 이름(말줄임).
function BabyPill({ baby, today }: { baby: Baby; today: string }) {
  const badgeId = useId()
  return (
    // 터치 영역 44px, 보이는 알약은 그 안.
    <Link
      to="/babies/$id"
      params={{ id: baby.id }}
      aria-label={baby.name}
      aria-describedby={badgeId}
      className="flex h-11 max-w-[65%] shrink-0 items-center rounded-full"
    >
      <span className="flex min-w-0 items-center gap-1.5 rounded-full bg-muted py-[3px] pr-2.5 pl-[3px]">
        <Avatar baby={baby} size={26} />
        <span className="min-w-0 truncate text-xs font-semibold">
          {baby.name}
        </span>
        <DayBadge id={badgeId} birthDate={baby.birth_date} today={today} />
      </span>
    </Link>
  )
}

// 한 줄: 왼쪽 우리 집 이름, 오른쪽 아기 알약(칩으로 고른 아이, 아니면 대표 아기).
// 아기 2명 이상이면 아래 칩 줄.
export function HomeHeader({ instanceName }: { instanceName?: string }) {
  const { baby } = route.useSearch()
  const babies = useBabies().data
  const primary = usePrimaryBaby()
  const today = useToday()
  const target = babies?.find((b) => b.id === baby) ?? primary
  return (
    <div className="px-4">
      <div className="flex h-14 items-center justify-between gap-3">
        <p className="min-w-0 flex-1 truncate text-base font-bold">
          {instanceName}
        </p>
        {target && <BabyPill baby={target} today={today} />}
      </div>
      {babies &&
        (babies.length >= 2 ||
          (baby && !babies.some((b) => b.id === baby))) && (
          <BabyChips babies={babies} selected={baby} />
        )}
    </div>
  )
}
