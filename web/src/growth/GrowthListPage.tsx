import {
  Navigate,
  getRouteApi,
  useCanGoBack,
  useRouter,
} from '@tanstack/react-router'
import IconAdd from '~icons/material-symbols/add-rounded'
import IconBack from '~icons/material-symbols/arrow-back-rounded'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Baby, GrowthRecord } from '@/api/types'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/i18n'
import { formatAgeLine } from '@/lib/age'
import { formatDate } from '@/lib/dates'
import { useBabies } from '@/timeline/useBabies'
import { GrowthSheet } from './GrowthSheet'
import { formatValues, useCanRecord, useGrowth } from './useGrowth'

const route = getRouteApi('/authed/shell/babies/$id/growth')

function LoadError({
  error,
  onRetry,
}: {
  error: unknown
  onRetry: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="grid justify-items-start gap-3 py-4">
      <p className="text-sm">{errorMessage(t, error)}</p>
      <Button variant="outline" onClick={onRetry}>
        {t('common.retry')}
      </Button>
    </div>
  )
}

// /babies/$id/growth. 셸 머리글 대신 뒤로 + 제목. 잰 날 내림차순, 보호자 이상은 눌러 고치기.
export function GrowthListPage() {
  const { t } = useTranslation()
  const { id } = route.useParams()
  const babies = useBabies()
  if (babies.isError && !babies.data) {
    return (
      <LoadError error={babies.error} onRetry={() => void babies.refetch()} />
    )
  }
  if (!babies.data) {
    return (
      <p className="py-4 text-sm text-muted-foreground">
        {t('common.loading')}
      </p>
    )
  }
  const baby = babies.data.find((b) => b.id === id)
  if (!baby) return <Navigate to="/babies" replace />
  return <GrowthList baby={baby} />
}

function GrowthList({ baby }: { baby: Baby }) {
  const { t, i18n } = useTranslation()
  const router = useRouter()
  const canGoBack = useCanGoBack()
  const growth = useGrowth(baby.id)
  const canRecord = useCanRecord(baby)
  // null 은 새 기록.
  const [editing, setEditing] = useState<GrowthRecord | null | undefined>()
  const rows = [...(growth.data ?? [])].reverse()

  return (
    <div className="-mt-4 grid gap-4">
      <header className="sticky top-0 z-10 -mx-4 flex min-h-14 items-center gap-1 bg-background px-2 py-1">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('day.back')}
          onClick={() => {
            if (canGoBack) router.history.back()
            else
              void router.navigate({
                to: '/babies/$id',
                params: { id: baby.id },
                replace: true,
              })
          }}
        >
          <IconBack aria-hidden className="size-6" />
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-lg font-bold">
          {t('growth.listTitle', { name: baby.name })}
        </h1>
        {canRecord && (
          <Button
            variant="ghost"
            className="text-accent-ink"
            aria-label={t('growth.addLabel')}
            onClick={() => {
              setEditing(null)
            }}
          >
            <IconAdd aria-hidden className="size-5" />
            {t('growth.add')}
          </Button>
        )}
      </header>
      <div className="mx-auto grid w-full max-w-[640px]">
        {growth.isPending ? (
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : growth.isError ? (
          <LoadError
            error={growth.error}
            onRetry={() => void growth.refetch()}
          />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('growth.empty')}</p>
        ) : (
          <ul aria-label={t('growth.listLabel')} className="divide-y">
            {rows.map((r) => {
              const content = (
                <>
                  <span className="block text-sm text-muted-foreground tabular-nums">
                    {formatDate(r.measured_on, i18n.language)}
                    {' · '}
                    {formatAgeLine(t, baby.birth_date, r.measured_on)}
                  </span>
                  <span className="block text-base font-semibold tabular-nums">
                    {formatValues(t, i18n.language, r)}
                  </span>
                  {r.note && (
                    <span className="block text-sm break-words text-muted-foreground">
                      {r.note}
                    </span>
                  )}
                </>
              )
              return (
                <li key={r.id}>
                  {canRecord ? (
                    <button
                      type="button"
                      className="block min-h-14 w-full px-1 py-3 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => {
                        setEditing(r)
                      }}
                    >
                      {content}
                    </button>
                  ) : (
                    <div className="px-1 py-3">{content}</div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
      {editing !== undefined && (
        <GrowthSheet
          babyId={baby.id}
          record={editing ?? undefined}
          onClose={() => {
            setEditing(undefined)
          }}
        />
      )}
    </div>
  )
}
