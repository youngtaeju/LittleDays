import { useMutation, useQueryClient } from '@tanstack/react-query'
import IconMore from '~icons/material-symbols/more-vert-rounded'
import { DropdownMenu } from 'radix-ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api, call } from '@/api/client'
import { isLogoutError } from '@/api/errors'
import { FormError } from '@/components/Field'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { MeSubPage } from '@/me/MeSubPage'
import { useSettings } from '@/settings/useSettings'
import { babiesKey } from '@/timeline/useBabies'
import { thumbUrl } from '@/timeline/media'
import { Tile } from '@/timeline/Tile'
import { formatInZone } from '@/viewer/zoned'
import { trashKey, useTrash } from './useTrash'
import { errorMessage } from '@/i18n'

type Confirm = 'permanent' | 'empty' | null

const DAY_MS = 24 * 60 * 60 * 1000

// 영구 삭제까지 남은 일수(올림, 최소 1). 자동 삭제 없음(0일)이면 null.
function daysLeft(deletedAt: string, retentionDays: number | undefined) {
  if (!retentionDays) return null
  const left =
    (Date.parse(deletedAt) + retentionDays * DAY_MS - Date.now()) / DAY_MS
  return Math.max(1, Math.ceil(left))
}

export function TrashPage() {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const settings = useSettings()
  const {
    items,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    isLoadingError,
    status,
    error,
    refetch,
  } = useTrash()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<Confirm>(null)
  // 복구·삭제로 목록에서 사라지면 시트도 닫힘.
  const selected = items.find((i) => i.id === selectedId) ?? null
  const select = useCallback((id: string) => {
    setSelectedId(id)
  }, [])

  const sentinel = useRef<HTMLDivElement>(null)
  const autoLoad = hasNextPage && !isFetchingNextPage && !isFetchNextPageError
  useEffect(() => {
    const el = sentinel.current
    if (!el || !autoLoad) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void fetchNextPage()
      },
      { rootMargin: '1000px 0px' },
    )
    io.observe(el)
    return () => {
      io.disconnect()
    }
  }, [autoLoad, fetchNextPage])

  function invalidate(withBabies: boolean) {
    void qc.invalidateQueries({ queryKey: trashKey })
    void qc.invalidateQueries({ queryKey: ['assets'] })
    void qc.invalidateQueries({ queryKey: ['days'] })
    // 휴지통 이동 시 서버가 이미 대표사진 지정 해제. 영구 삭제 후 아기 캐시 재확인용.
    if (withBabies) void qc.invalidateQueries({ queryKey: babiesKey })
  }

  const restore = useMutation({
    mutationFn: (id: string) =>
      call(api.POST('/api/assets/{id}/restore', { params: { path: { id } } })),
    onSuccess: () => {
      invalidate(false)
      setSelectedId(null)
      toast(t('trash.restored'))
    },
    onError: (e) => {
      if (!isLogoutError(e)) toast.error(errorMessage(t, e))
    },
  })

  const remove = useMutation({
    mutationFn: (id: string) =>
      call(
        api.DELETE('/api/assets/{id}/permanent', {
          params: { path: { id } },
        }),
      ),
    onSuccess: () => {
      invalidate(true)
      setConfirm(null)
      setSelectedId(null)
      toast(t('trash.permanentDone'))
    },
  })

  const empty = useMutation({
    mutationFn: () => call(api.POST('/api/trash/empty')),
    onSuccess: ({ deleted }) => {
      invalidate(true)
      setConfirm(null)
      setSelectedId(null)
      toast(t('trash.emptied', { count: deleted }))
    },
  })

  function closeConfirm() {
    setConfirm(null)
    remove.reset()
    empty.reset()
  }

  const days = settings?.trash_retention_days

  const menu = (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('trash.more')}>
          <IconMore aria-hidden className="size-6" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-48 rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          <DropdownMenu.Item
            disabled={items.length === 0}
            className="flex min-h-11 cursor-default items-center rounded-lg px-3 text-sm text-destructive outline-none select-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent"
            onSelect={() => {
              setConfirm('empty')
            }}
          >
            {t('trash.empty')}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )

  return (
    <MeSubPage title={t('nav.trash')} actions={menu}>
      {days != null && (
        <p className="text-sm text-muted-foreground">
          {days === 0
            ? t('trash.retentionNever')
            : t('trash.retention', { count: days })}
        </p>
      )}
      {status === 'pending' && (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      )}
      {isLoadingError && (
        <div className="grid justify-items-start gap-3">
          <p className="text-sm">{errorMessage(t, error)}</p>
          <Button variant="outline" onClick={() => void refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      )}
      {status === 'success' && items.length === 0 && (
        <p className="py-16 text-center text-base">{t('trash.emptyState')}</p>
      )}
      <ul className="-mx-4 grid grid-cols-3 gap-[2px] sm:mx-0 sm:grid-cols-4 lg:grid-cols-6">
        {items.map((item) => {
          const left = daysLeft(item.deleted_at, days)
          return (
            <li key={item.id} className="relative">
              <Tile
                item={item}
                timezone={settings?.timezone}
                onSelect={select}
                extraLabel={
                  left === null
                    ? undefined
                    : t('trash.daysLeft', { count: left })
                }
              />
              {left !== null && (
                <span className="pointer-events-none absolute bottom-0 left-0 bg-black/60 px-1.5 py-0.5 text-xs font-semibold text-white tabular-nums">
                  {t('trash.daysLeft', { count: left })}
                </span>
              )}
            </li>
          )
        })}
      </ul>
      <div ref={sentinel} />
      {isFetchingNextPage && (
        <p className="py-4 text-center text-sm text-muted-foreground">
          {t('common.loading')}
        </p>
      )}
      {isFetchNextPageError && (
        <div className="grid justify-items-center gap-3 py-4">
          <p className="text-sm">{errorMessage(t, error)}</p>
          <Button variant="outline" onClick={() => void fetchNextPage()}>
            {t('common.retry')}
          </Button>
        </div>
      )}

      <Sheet
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null)
        }}
      >
        <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>{t('trash.itemTitle')}</SheetTitle>
                <SheetDescription>
                  {t('trash.deletedAt', {
                    time: formatInZone(
                      selected.deleted_at,
                      settings?.timezone ?? 'UTC',
                      i18n.language,
                    ),
                  })}
                </SheetDescription>
              </SheetHeader>
              {selected.status === 'ready' && (
                <img
                  src={thumbUrl(selected.id)}
                  alt=""
                  className="mx-auto max-h-64 rounded-md object-contain"
                />
              )}
              <SheetFooter>
                <Button
                  disabled={restore.isPending}
                  onClick={() => {
                    restore.mutate(selected.id)
                  }}
                >
                  {t('trash.restore')}
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    setConfirm('permanent')
                  }}
                >
                  {t('trash.permanent')}
                </Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>

      <Dialog
        open={
          confirm === 'empty' || (confirm === 'permanent' && selected !== null)
        }
        onOpenChange={(open) => {
          if (!open) closeConfirm()
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm === 'empty'
                ? t('trash.emptyTitle')
                : t('trash.permanentTitle')}
            </DialogTitle>
            <DialogDescription>
              {confirm === 'empty'
                ? hasNextPage
                  ? t('trash.emptyConfirmMore', { count: items.length })
                  : t('trash.emptyConfirm', { count: items.length })
                : t('trash.permanentConfirm')}
            </DialogDescription>
          </DialogHeader>
          <FormError error={confirm === 'empty' ? empty.error : remove.error} />
          <DialogFooter>
            <Button variant="outline" onClick={closeConfirm}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending || empty.isPending}
              onClick={() => {
                if (confirm === 'empty') empty.mutate()
                else if (selected) remove.mutate(selected.id)
              }}
            >
              {confirm === 'empty' ? t('trash.empty') : t('trash.permanent')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MeSubPage>
  )
}
