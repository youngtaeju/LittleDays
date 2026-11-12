import { Link } from '@tanstack/react-router'
import IconAdd from '~icons/material-symbols/add-rounded'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Baby, MilestoneSummary } from '@/api/types'
import { Button } from '@/components/ui/button'
import { isBorn, useCanRecord } from '@/growth/useGrowth'
import { errorMessage } from '@/i18n'
import { formatAgeLine } from '@/lib/age'
import { formatShortDate } from '@/lib/dates'
import { useToday } from '@/settings/useSettings'
import { thumbUrl } from '@/timeline/media'
import { milestoneLabel } from './labels'
import { MilestonePickerSheet } from './MilestonePickerSheet'
import { useMilestones } from './useMilestones'

// 줄마다 사진 썸네일 최대 개수.
const THUMBS = 3

function Thumbs({ m }: { m: MilestoneSummary }) {
  if (m.previews.length === 0) return null
  return (
    <span aria-hidden className="flex shrink-0 gap-1">
      {m.previews.slice(0, THUMBS).map((a) => (
        <span
          key={a.id}
          className="size-10 overflow-hidden rounded-md bg-muted"
          style={a.dominant_color ? { backgroundColor: a.dominant_color } : {}}
        >
          {a.status === 'ready' && (
            <img
              src={thumbUrl(a.id)}
              alt=""
              loading="lazy"
              decoding="async"
              className="size-full object-cover"
            />
          )}
        </span>
      ))}
    </span>
  )
}

// 아기 화면 "마일스톤". 최근 순 세로 타임라인(이름, 날짜, 그때 나이, 사진 썸네일), 기록 추가.
export function MilestoneSection({ baby }: { baby: Baby }) {
  const { t, i18n } = useTranslation()
  const today = useToday()
  const canRecord = useCanRecord(baby)
  const milestones = useMilestones(baby.id)
  const [adding, setAdding] = useState(false)
  const titleId = useId()
  // 서버는 달성일 오름차순.
  const items = [...(milestones.data ?? [])].reverse()

  return (
    <section aria-labelledby={titleId} className="grid gap-3">
      <div className="flex min-h-11 items-center justify-between gap-2">
        <h2 id={titleId} className="text-base font-bold">
          {t('milestones.title')}
        </h2>
        {canRecord && (
          <Button
            variant="ghost"
            className="text-accent-ink"
            aria-label={t('milestones.addLabel')}
            onClick={() => {
              setAdding(true)
            }}
          >
            <IconAdd aria-hidden className="size-5" />
            {t('milestones.add')}
          </Button>
        )}
      </div>
      {!isBorn(baby, today) ? (
        <p className="text-sm text-muted-foreground">
          {t('milestones.unborn')}
        </p>
      ) : milestones.isPending ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : milestones.isError ? (
        <div className="grid justify-items-start gap-3">
          <p className="text-sm">{errorMessage(t, milestones.error)}</p>
          <Button variant="outline" onClick={() => void milestones.refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('milestones.empty')}</p>
      ) : (
        // 왼쪽 세로선과 점(장식).
        <ol
          aria-label={t('milestones.listLabel')}
          className="relative grid before:absolute before:top-3 before:bottom-3 before:left-[5px] before:w-0.5 before:bg-accent-soft"
        >
          {items.map((m) => {
            const name = milestoneLabel(t, m)
            const date = formatShortDate(m.achieved_on, today, i18n.language)
            const age = formatAgeLine(t, baby.birth_date, m.achieved_on)
            const label = [
              name,
              date,
              age,
              m.asset_count > 0
                ? t('feed.photos', { count: m.asset_count })
                : null,
            ]
              .filter(Boolean)
              .join(', ')
            return (
              <li key={m.id} className="relative pl-6">
                <span
                  aria-hidden
                  className="absolute top-4 left-0 size-3 rounded-full bg-primary"
                />
                <Link
                  to="/milestones/$id"
                  params={{ id: m.id }}
                  aria-label={label}
                  className="flex min-h-12 items-center gap-3 rounded-lg py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="grid min-w-0 flex-1">
                    <span className="text-[15px] font-semibold wrap-anywhere">
                      {name}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {age ? `${date} · ${age}` : date}
                    </span>
                  </span>
                  <Thumbs m={m} />
                </Link>
              </li>
            )
          })}
        </ol>
      )}
      {adding && (
        <MilestonePickerSheet
          babyId={baby.id}
          onClose={() => {
            setAdding(false)
          }}
        />
      )}
    </section>
  )
}
