import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, call } from '@/api/client'
import type { Baby } from '@/api/types'
import { hasRole, useMe } from '@/auth/session'
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
import { useSettings } from '@/settings/useSettings'
import { ageAt, formatAge } from '@/timeline/age'
import { thumbUrl } from '@/timeline/media'
import { babiesKey, useBabies } from '@/timeline/useBabies'
import { todayInZone } from '@/viewer/zoned'
import { BabyForm } from './BabyForm'

type Dialogs =
  | { kind: 'add' }
  | { kind: 'edit'; baby: Baby }
  | { kind: 'delete'; baby: Baby }

function Avatar({ baby }: { baby: Baby }) {
  return baby.avatar_asset_id ? (
    <img
      src={thumbUrl(baby.avatar_asset_id)}
      alt=""
      className="size-12 shrink-0 rounded-full object-cover"
    />
  ) : (
    <span
      aria-hidden
      className="flex size-12 shrink-0 items-center justify-center rounded-full bg-muted text-lg font-semibold text-muted-foreground"
    >
      {Array.from(baby.name)[0]}
    </span>
  )
}

// 삭제 시 태그도 제거되므로 사진 목록도 무효화.
function invalidateAfterDelete(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: babiesKey }),
    qc.invalidateQueries({ queryKey: ['assets'] }),
  ])
}

export function BabiesPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { user } = useMe()
  const settings = useSettings()
  const babies = useBabies()
  const [dialog, setDialog] = useState<Dialogs | null>(null)
  const canManage = hasRole(user, 'guardian')

  const reorder = useMutation({
    mutationFn: (ids: string[]) =>
      call(api.PUT('/api/babies/order', { body: { ids } })),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: babiesKey })
      const prev = qc.getQueryData<Baby[]>(babiesKey)
      if (prev) {
        qc.setQueryData(
          babiesKey,
          ids.flatMap((id) => prev.filter((b) => b.id === id)),
        )
      }
      return { prev }
    },
    onError: (_e, _ids, ctx) => {
      if (ctx?.prev) qc.setQueryData(babiesKey, ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: babiesKey }),
  })

  const remove = useMutation({
    mutationFn: (id: string) =>
      call(api.DELETE('/api/babies/{id}', { params: { path: { id } } })),
    onSuccess: async () => {
      await invalidateAfterDelete(qc)
      setDialog(null)
    },
  })

  const list = babies.data ?? []
  const today = settings ? todayInZone(settings.timezone) : null

  function move(index: number, delta: -1 | 1) {
    const ids = list.map((b) => b.id)
    const target = ids[index + delta]
    const current = ids[index]
    if (target === undefined || current === undefined) return
    ids[index + delta] = current
    ids[index] = target
    reorder.mutate(ids)
  }

  function close() {
    setDialog(null)
    remove.reset()
  }

  return (
    <div className="mx-auto grid max-w-xl gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">{t('nav.babies')}</h1>
        {canManage && (
          <Button
            onClick={() => {
              setDialog({ kind: 'add' })
            }}
          >
            {t('babies.add')}
          </Button>
        )}
      </div>
      <FormError error={babies.error ?? reorder.error} />
      {babies.isSuccess && list.length === 0 && (
        <div className="grid justify-items-start gap-3">
          <p className="text-sm text-muted-foreground">
            {t(canManage ? 'babies.emptyManage' : 'babies.empty')}
          </p>
          {canManage && (
            <Button
              onClick={() => {
                setDialog({ kind: 'add' })
              }}
            >
              {t('babies.add')}
            </Button>
          )}
        </div>
      )}
      <ul className="grid gap-2">
        {list.map((baby, i) => {
          const age = today ? ageAt(baby.birth_date, today) : null
          return (
            <li
              key={baby.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-card p-3"
            >
              <Avatar baby={baby} />
              <div className="min-w-0 flex-1 basis-40">
                <p className="truncate font-semibold">{baby.name}</p>
                <p className="text-sm text-muted-foreground">
                  {baby.birth_date}
                </p>
                {age && (
                  <p className="text-sm text-muted-foreground">
                    {formatAge(t, age)}
                  </p>
                )}
              </div>
              {canManage && (
                <div className="ml-auto flex shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('babies.moveUp', { name: baby.name })}
                    disabled={i === 0 || reorder.isPending}
                    onClick={() => {
                      move(i, -1)
                    }}
                  >
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('babies.moveDown', { name: baby.name })}
                    disabled={i === list.length - 1 || reorder.isPending}
                    onClick={() => {
                      move(i, 1)
                    }}
                  >
                    <ArrowDown aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('babies.edit', { name: baby.name })}
                    onClick={() => {
                      setDialog({ kind: 'edit', baby })
                    }}
                  >
                    <Pencil aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('babies.delete', { name: baby.name })}
                    onClick={() => {
                      setDialog({ kind: 'delete', baby })
                    }}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) close()
        }}
      >
        <DialogContent>
          {dialog?.kind === 'delete' ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  {t('babies.deleteTitle', { name: dialog.baby.name })}
                </DialogTitle>
                <DialogDescription>
                  {t('babies.deleteConfirm')}
                </DialogDescription>
              </DialogHeader>
              <FormError error={remove.error} />
              <DialogFooter>
                <Button variant="outline" onClick={close}>
                  {t('common.cancel')}
                </Button>
                <Button
                  variant="destructive"
                  disabled={remove.isPending}
                  onClick={() => {
                    remove.mutate(dialog.baby.id)
                  }}
                >
                  {t('common.delete')}
                </Button>
              </DialogFooter>
            </>
          ) : (
            dialog && (
              <>
                <DialogHeader>
                  <DialogTitle>
                    {dialog.kind === 'add'
                      ? t('babies.add')
                      : t('babies.editTitle')}
                  </DialogTitle>
                  <DialogDescription className="sr-only">
                    {t('babies.formDescription')}
                  </DialogDescription>
                </DialogHeader>
                <BabyForm
                  key={dialog.kind === 'edit' ? dialog.baby.id : 'add'}
                  baby={dialog.kind === 'edit' ? dialog.baby : undefined}
                  onDone={close}
                />
              </>
            )
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
