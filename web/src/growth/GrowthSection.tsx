import { Link } from '@tanstack/react-router'
import IconAdd from '~icons/material-symbols/add-rounded'
import IconChevron from '~icons/material-symbols/chevron-right-rounded'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Baby } from '@/api/types'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/i18n'
import { formatDate, formatMonthDay } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useToday } from '@/settings/useSettings'
import { GrowthChart } from './GrowthChart'
import { GrowthSheet } from './GrowthSheet'
import type { GrowthKind } from './lms'
import { formatValues, isBorn, useCanRecord, useGrowth } from './useGrowth'

// 올해면 "11월 3일", 아니면 연도까지.
function formatShortDate(date: string, today: string, lng: string): string {
  return date.slice(0, 4) === today.slice(0, 4)
    ? formatMonthDay(date, lng)
    : formatDate(date, lng)
}

// 아기 화면 "성장". 최근 값, 키/몸무게 탭, 차트, 기록 추가와 전체 보기.
export function GrowthSection({ baby }: { baby: Baby }) {
  const { t, i18n } = useTranslation()
  const today = useToday()
  const growth = useGrowth(baby.id)
  const canRecord = useCanRecord(baby)
  const [kind, setKind] = useState<GrowthKind>('height')
  const [adding, setAdding] = useState(false)
  const titleId = useId()
  const panelId = useId()
  const records = growth.data ?? []
  const latest = records.at(-1)

  return (
    <section aria-labelledby={titleId} className="grid gap-3">
      <div className="flex min-h-11 items-center justify-between gap-2">
        <h2 id={titleId} className="text-base font-bold">
          {t('growth.title')}
        </h2>
        {canRecord && (
          <Button
            variant="ghost"
            className="text-accent-ink"
            aria-label={t('growth.addLabel')}
            onClick={() => {
              setAdding(true)
            }}
          >
            <IconAdd aria-hidden className="size-5" />
            {t('growth.add')}
          </Button>
        )}
      </div>
      {!isBorn(baby, today) ? (
        <p className="text-sm text-muted-foreground">{t('growth.unborn')}</p>
      ) : growth.isPending ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : growth.isError ? (
        <div className="grid justify-items-start gap-3">
          <p className="text-sm">{errorMessage(t, growth.error)}</p>
          <Button variant="outline" onClick={() => void growth.refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      ) : !latest ? (
        <p className="text-sm text-muted-foreground">{t('growth.empty')}</p>
      ) : (
        <>
          <p className="text-sm font-semibold tabular-nums">
            {t('growth.latest', {
              values: formatValues(t, i18n.language, latest),
              date: formatShortDate(latest.measured_on, today, i18n.language),
            })}
          </p>
          <div
            role="tablist"
            aria-label={t('growth.tabs')}
            className="flex gap-2"
          >
            {(['height', 'weight'] as const).map((k) => {
              const on = k === kind
              return (
                // 터치 영역 44px, 보이는 탭은 그 안.
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  aria-controls={panelId}
                  onClick={() => {
                    setKind(k)
                  }}
                  className="flex h-11 items-center"
                >
                  <span
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs',
                      on
                        ? 'border-foreground bg-foreground font-semibold text-background'
                        : 'border-border',
                    )}
                  >
                    {k === 'height' ? t('growth.height') : t('growth.weight')}
                  </span>
                </button>
              )
            })}
          </div>
          <div id={panelId} role="tabpanel">
            <GrowthChart records={records} baby={baby} kind={kind} />
          </div>
          <Link
            to="/babies/$id/growth"
            params={{ id: baby.id }}
            className="flex min-h-11 items-center gap-0.5 justify-self-start text-sm font-semibold text-accent-ink"
          >
            {t('growth.viewAll')}
            <IconChevron aria-hidden className="size-5" />
          </Link>
        </>
      )}
      {adding && (
        <GrowthSheet
          babyId={baby.id}
          onClose={() => {
            setAdding(false)
          }}
        />
      )}
    </section>
  )
}
