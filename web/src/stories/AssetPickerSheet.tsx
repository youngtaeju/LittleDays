import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AssetSummary } from '@/api/types'
import { FormError } from '@/components/Field'
import { Button } from '@/components/ui/button'
import { useSettings } from '@/settings/useSettings'
import { Tile } from '@/timeline/Tile'
import { useTimeline } from '@/timeline/useTimeline'
import { AdaptiveSheet } from '@/upload/AdaptiveSheet'

// 올린 사진에서 여러 장 고르기. date 가 있으면 그날 사진 먼저, "다른 날"로 전체 타임라인.
// onDone: 고른 순서 그대로(기존 선택 뒤에 새로 누른 순서). onClose: 바꾸지 않고 닫기.
// doneDisabled: 고르기 끝 버튼 막기(끝내자마자 저장하는 쪽의 오프라인 등).
export function AssetPickerSheet({
  date,
  selected,
  onDone,
  onClose,
  doneDisabled = false,
}: {
  date?: string | undefined
  selected: readonly AssetSummary[]
  onDone: (assets: AssetSummary[]) => void
  onClose: () => void
  doneDisabled?: boolean
}) {
  const { t } = useTranslation()
  const settings = useSettings()
  const [allDays, setAllDays] = useState(!date)
  const [picked, setPicked] = useState<readonly AssetSummary[]>(selected)
  const day = useTimeline(undefined, { date, enabled: !allDays })
  const all = useTimeline(undefined, { enabled: allDays })
  const list = allDays ? all : day

  const byId = useMemo(
    () => new Map(list.items.map((a) => [a.id, a])),
    [list.items],
  )
  const toggle = useCallback(
    (id: string) => {
      setPicked((prev) => {
        if (prev.some((a) => a.id === id))
          return prev.filter((a) => a.id !== id)
        const asset = byId.get(id)
        return asset ? [...prev, asset] : prev
      })
    },
    [byId],
  )

  const sentinel = useRef<HTMLDivElement>(null)
  const { fetchNextPage } = list
  const autoLoad =
    list.hasNextPage && !list.isFetchingNextPage && !list.isFetchNextPageError
  useEffect(() => {
    const el = sentinel.current
    if (!el || !autoLoad) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void fetchNextPage()
      },
      { rootMargin: '600px 0px' },
    )
    io.observe(el)
    return () => {
      io.disconnect()
    }
  }, [autoLoad, fetchNextPage])

  return (
    <AdaptiveSheet title={t('stories.pickTitle')} onClose={onClose}>
      <div className="grid gap-3">
        {date && (
          <div className="flex justify-end">
            <Button
              variant="outline"
              className="h-11"
              onClick={() => {
                setAllDays(!allDays)
              }}
            >
              {allDays ? t('stories.thatDay') : t('stories.otherDays')}
            </Button>
          </div>
        )}
        {list.status === 'pending' ? (
          <p className="py-8 text-center text-[13px] text-muted-foreground">
            {t('common.loading')}
          </p>
        ) : list.isLoadingError ? (
          <div className="grid justify-items-center gap-2 py-8">
            <FormError error={list.error} />
            <Button variant="outline" onClick={() => void list.refetch()}>
              {t('common.retry')}
            </Button>
          </div>
        ) : list.items.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-muted-foreground">
            {allDays ? t('stories.pickEmptyAll') : t('stories.pickEmptyDay')}
          </p>
        ) : (
          <div
            role="group"
            aria-label={t('stories.pickGrid')}
            className="-mx-4 grid grid-cols-4 gap-0.5 lg:mx-0"
          >
            {list.items.map((item) => {
              const order = picked.findIndex((a) => a.id === item.id) + 1
              return (
                <div key={item.id} className="relative">
                  <Tile
                    item={item}
                    timezone={settings?.timezone}
                    onSelect={toggle}
                    pressed={order > 0}
                    extraLabel={
                      order > 0
                        ? t('stories.pickedOrder', { index: order })
                        : undefined
                    }
                  />
                  {order > 0 && (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0 grid place-items-start p-1 ring-3 ring-primary ring-inset"
                    >
                      <span className="grid size-6 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground tabular-nums">
                        {order}
                      </span>
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
        <div ref={sentinel} />
        <div className="sticky bottom-0 bg-background pt-2 pb-1">
          <Button
            className="h-11 w-full"
            disabled={doneDisabled}
            onClick={() => {
              onDone([...picked])
            }}
          >
            {t('stories.pickDone', { count: picked.length })}
          </Button>
        </div>
      </div>
    </AdaptiveSheet>
  )
}
