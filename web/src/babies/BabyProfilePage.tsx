import { getRouteApi, Link, Navigate } from '@tanstack/react-router'
import IconProgress from '~icons/material-symbols/progress-activity-rounded'
import IconWarning from '~icons/material-symbols/warning-outline-rounded'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgeMonth, Baby } from '@/api/types'
import { hasRole, useMe } from '@/auth/session'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/i18n'
import {
  dayNumber,
  dueIn,
  formatAgeLine,
  formatNextAnniversary,
  nextAnniversary,
} from '@/lib/age'
import { formatDate } from '@/lib/dates'
import { useToday } from '@/settings/useSettings'
import { Blurhash } from '@/timeline/Blurhash'
import { thumbUrl } from '@/timeline/media'
import { useBabies } from '@/timeline/useBabies'
import { Avatar } from './Avatar'
import { BabyManager } from './BabyManager'
import { BabySwitcher } from './BabySwitcher'
import { saveLastBaby } from './lastBaby'
import { ageMonthLabel, ageParam, useBabyStats } from './useBabyStats'

const route = getRouteApi('/authed/shell/babies/$id')

function ProfileHeader({ baby }: { baby: Baby }) {
  const { t, i18n } = useTranslation()
  const today = useToday()
  const birth = formatDate(baby.birth_date, i18n.language)
  const due = dueIn(baby.birth_date, today)
  const next = nextAnniversary(baby.birth_date, today)
  return (
    <div className="flex min-w-0 items-center gap-4">
      <Avatar baby={baby} size={72} />
      <div className="min-w-0">
        <h1 className="truncate text-xl font-bold">{baby.name}</h1>
        <p className="text-sm text-muted-foreground tabular-nums">
          {due === null
            ? t('babies.ageLine', {
                age: formatAgeLine(t, baby.birth_date, today),
                date: birth,
              })
            : t('babies.dueDate', { date: birth })}
        </p>
        <p className="text-sm tabular-nums">
          <span className="font-semibold text-accent-ink">
            {due === null
              ? t('feed.dPlus', { n: dayNumber(baby.birth_date, today) })
              : t('feed.dMinus', { n: due })}
          </span>
          {next && (
            <>
              {' · '}
              <span className="text-muted-foreground">
                {formatNextAnniversary(t, next)}
              </span>
            </>
          )}
        </p>
      </div>
    </div>
  )
}

function Numbers({ id }: { id: string }) {
  const { t } = useTranslation()
  const stats = useBabyStats(id).data
  if (!stats) return null
  const boxes = [
    { n: stats.photo_count, label: t('babies.photos') },
    { n: stats.video_count, label: t('babies.videos') },
    { n: stats.day_count, label: t('babies.days') },
  ]
  return (
    <ul aria-label={t('babies.numbers')} className="grid grid-cols-3 gap-2">
      {boxes.map((b) => (
        <li
          key={b.label}
          className="grid justify-items-center rounded-lg bg-muted px-2 py-3"
        >
          <span className="text-lg font-bold tabular-nums">{b.n}</span>
          <span className="text-xs text-muted-foreground">{b.label}</span>
        </li>
      ))}
    </ul>
  )
}

// 표지는 서버가 ready 우선으로 고름. 처리 중·실패(그 개월에 ready 없음)는 blurhash·상태 표시.
function MonthCard({ babyId, month }: { babyId: string; month: AgeMonth }) {
  const { t } = useTranslation()
  const { cover } = month
  const label = ageMonthLabel(t, month.age_month)
  const count = t('babies.count', { count: month.count })
  return (
    <li>
      <Link
        to="/babies/$id/age/$age"
        params={{ id: babyId, age: ageParam(month.age_month) }}
        aria-label={`${label}, ${count}`}
        className="relative block aspect-[3/4] overflow-hidden rounded-md bg-muted"
        style={
          cover.dominant_color
            ? { backgroundColor: cover.dominant_color }
            : undefined
        }
      >
        {cover.blurhash && (
          <Blurhash
            hash={cover.blurhash}
            className="absolute inset-0 size-full"
          />
        )}
        {cover.status === 'ready' && (
          <img
            src={thumbUrl(cover.id)}
            alt=""
            loading="lazy"
            decoding="async"
            className="absolute inset-0 size-full object-cover"
          />
        )}
        {cover.status === 'processing' && (
          <span className="absolute top-1 right-1 rounded-full bg-black/50 p-1 text-white">
            <IconProgress
              role="img"
              aria-label={t('timeline.processing')}
              className="size-4 animate-spin motion-reduce:animate-none"
            />
          </span>
        )}
        {cover.status === 'failed' && (
          <IconWarning
            role="img"
            aria-label={t('timeline.failed')}
            className="absolute inset-0 m-auto size-6 text-muted-foreground"
          />
        )}
        {/* 사진 위 글자 대비용 반투명 띠(그라데이션 아님). */}
        <span className="absolute inset-x-0 bottom-0 grid bg-black/60 px-2 py-1 text-white">
          <span className="truncate text-sm font-semibold">{label}</span>
          <span className="text-xs tabular-nums">{count}</span>
        </span>
      </Link>
    </li>
  )
}

function MonthAlbums({ id }: { id: string }) {
  const { t } = useTranslation()
  const stats = useBabyStats(id)
  return (
    <section aria-labelledby="age-albums" className="grid gap-3">
      <h2 id="age-albums" className="text-base font-bold">
        {t('babies.albums')}
      </h2>
      {stats.isPending && (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      )}
      {stats.isError && (
        <div className="grid justify-items-start gap-3">
          <p className="text-sm">{errorMessage(t, stats.error)}</p>
          <Button variant="outline" onClick={() => void stats.refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      )}
      {stats.data?.age_months.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('babies.noPhotos')}</p>
      )}
      {stats.data && stats.data.age_months.length > 0 && (
        <ul className="grid grid-cols-3 gap-2">
          {stats.data.age_months.map((m) => (
            <MonthCard key={m.age_month} babyId={id} month={m} />
          ))}
        </ul>
      )}
    </section>
  )
}

// 아기 탭. 머리글(이름·나이)·숫자 상자·개월별 앨범.
export function BabyProfilePage() {
  const { t } = useTranslation()
  const { id } = route.useParams()
  const { user } = useMe()
  const babies = useBabies()
  const baby = babies.data?.find((b) => b.id === id)

  useEffect(() => {
    if (baby) saveLastBaby(baby.id)
  }, [baby])

  if (babies.isError && !babies.data) {
    return (
      <div className="grid justify-items-start gap-3 py-4">
        <p className="text-sm">{errorMessage(t, babies.error)}</p>
        <Button variant="outline" onClick={() => void babies.refetch()}>
          {t('common.retry')}
        </Button>
      </div>
    )
  }
  if (!babies.data) {
    return (
      <p className="py-4 text-sm text-muted-foreground">
        {t('common.loading')}
      </p>
    )
  }
  // 지운 아기·잘못된 주소 → 마지막 본 아기 또는 첫째(없으면 빈 화면).
  if (!baby) return <Navigate to="/babies" replace />

  return (
    <div className="mx-auto grid max-w-[640px] grid-cols-1 gap-6">
      {babies.data.length > 1 && <BabySwitcher babies={babies.data} />}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <ProfileHeader baby={baby} />
        </div>
        {hasRole(user, 'guardian') && <BabyManager />}
      </div>
      <Numbers id={baby.id} />
      <MonthAlbums id={baby.id} />
    </div>
  )
}
