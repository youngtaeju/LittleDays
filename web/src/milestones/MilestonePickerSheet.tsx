import { useNavigate } from '@tanstack/react-router'
import IconAdd from '~icons/material-symbols/add-rounded'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Baby, MilestoneSummary } from '@/api/types'
import { BabyRadioGroup } from '@/babies/BabyRadioGroup'
import { pickBaby } from '@/babies/lastBaby'
import { FormError } from '@/components/Field'
import { Button } from '@/components/ui/button'
import { isBorn } from '@/growth/useGrowth'
import { errorMessage } from '@/i18n'
import { formatShortDate } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useToday } from '@/settings/useSettings'
import { useBabies } from '@/timeline/useBabies'
import { AdaptiveSheet } from '@/upload/AdaptiveSheet'
import { milestoneLabel } from './labels'
import { MilestoneSheet } from './MilestoneSheet'
import {
  MILESTONE_GROUPS,
  MILESTONE_PRESETS,
  rangeText,
  type MilestoneGroup,
} from './presets'
import { useMilestones } from './useMilestones'

// 마일스톤 고르기. 무리별 미리 정한 항목 + 직접 입력. 고르면 같은 자리에서 입력 시트로.
// babyId 가 없으면 태어난 아기 중 고르기(둘 이상일 때 맨 위).
export function MilestonePickerSheet({
  babyId,
  onClose,
}: {
  babyId?: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const today = useToday()
  const babies = useBabies()
  const born = (babies.data ?? []).filter((b) => isBorn(b, today))
  const fixed = babyId ? babies.data?.find((b) => b.id === babyId) : undefined
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const baby = fixed ?? born.find((b) => b.id === selectedId) ?? pickBaby(born)
  // undefined: 고르는 중. null: 직접 입력.
  const [form, setForm] = useState<string | null | undefined>(undefined)

  if (baby && form !== undefined) {
    return (
      <MilestoneSheet
        baby={baby}
        preset={form ?? undefined}
        onClose={onClose}
      />
    )
  }

  let body
  if (babies.isPending) {
    body = (
      <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
    )
  } else if (babies.isError) {
    body = <FormError error={babies.error} />
  } else if (babyId && !fixed) {
    body = <p className="text-sm">{t('errors.babies.notFound')}</p>
  } else if (!baby) {
    body = <p className="text-sm">{t('milestones.noBabies')}</p>
  } else {
    body = (
      <div className="grid gap-2">
        {!fixed && born.length > 1 && (
          <BabyRadioGroup
            label={t('milestones.baby')}
            babies={born}
            selected={baby.id}
            onSelect={setSelectedId}
          />
        )}
        <PresetList baby={baby} onPick={setForm} onLeave={onClose} />
      </div>
    )
  }
  return (
    <AdaptiveSheet title={t('milestones.pickerTitle')} onClose={onClose}>
      {body}
    </AdaptiveSheet>
  )
}

const ROW =
  'flex min-h-12 w-full items-center justify-between gap-3 border-b px-1 py-2 text-left text-[15px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring'

function PresetList({
  baby,
  onPick,
  onLeave,
}: {
  baby: Baby
  onPick: (preset: string | null) => void
  onLeave: () => void
}) {
  const { t } = useTranslation()
  const milestones = useMilestones(baby.id)
  if (milestones.isPending) {
    return (
      <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
    )
  }
  if (milestones.isError) {
    return (
      <div className="grid justify-items-start gap-3">
        <p className="text-sm">{errorMessage(t, milestones.error)}</p>
        <Button variant="outline" onClick={() => void milestones.refetch()}>
          {t('common.retry')}
        </Button>
      </div>
    )
  }
  const recorded = new Map(
    milestones.data.flatMap((m): [string, MilestoneSummary][] =>
      m.preset_key ? [[m.preset_key, m]] : [],
    ),
  )
  return (
    <div className="grid gap-2">
      {MILESTONE_GROUPS.map((g) => (
        <PresetGroup
          key={g}
          group={g}
          recorded={recorded}
          onPick={onPick}
          onLeave={onLeave}
        />
      ))}
      <button
        type="button"
        className={cn(ROW, 'justify-start gap-2 border-b-0 font-semibold')}
        onClick={() => {
          onPick(null)
        }}
      >
        <IconAdd aria-hidden className="size-5 text-accent-ink" />
        {t('milestones.custom')}
      </button>
    </div>
  )
}

function PresetGroup({
  group,
  recorded,
  onPick,
  onLeave,
}: {
  group: MilestoneGroup
  recorded: Map<string, MilestoneSummary>
  onPick: (preset: string) => void
  onLeave: () => void
}) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const today = useToday()
  const headingId = useId()
  return (
    <div role="group" aria-labelledby={headingId}>
      <p
        id={headingId}
        className="pt-2 pb-1 text-xs font-semibold text-muted-foreground"
      >
        {t(`milestones.groups.${group}`)}
      </p>
      <ul>
        {MILESTONE_PRESETS.filter((p) => p.group === group).map((p) => {
          const done = recorded.get(p.key)
          const name = milestoneLabel(t, {
            preset_key: p.key,
            custom_label: null,
          })
          const side = done
            ? t('milestones.recordedOn', {
                date: formatShortDate(done.achieved_on, today, i18n.language),
              })
            : rangeText(t, p.range)
          return (
            <li key={p.key}>
              {/* 기록한 항목은 흐리게. 누르면 그 상세. */}
              <button
                type="button"
                data-recorded={done ? '' : undefined}
                className={ROW}
                onClick={() => {
                  if (done) {
                    onLeave()
                    void navigate({
                      to: '/milestones/$id',
                      params: { id: done.id },
                    })
                  } else onPick(p.key)
                }}
              >
                <span
                  className={cn('min-w-0', done && 'text-muted-foreground')}
                >
                  {name}
                </span>
                {side && (
                  <span
                    className={cn(
                      'shrink-0 text-xs tabular-nums',
                      done ? 'text-accent-ink' : 'text-muted-foreground',
                    )}
                  >
                    {side}
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
