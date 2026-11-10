import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import IconArrowDown from '~icons/material-symbols/arrow-downward-rounded'
import IconArrowUp from '~icons/material-symbols/arrow-upward-rounded'
import IconDelete from '~icons/material-symbols/delete-outline-rounded'
import IconEdit from '~icons/material-symbols/edit-outline-rounded'
import IconMore from '~icons/material-symbols/more-vert-rounded'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, call } from '@/api/client'
import type { Baby } from '@/api/types'
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
import { babiesKey, useBabies } from '@/timeline/useBabies'
import { Avatar } from './Avatar'
import { BabyForm } from './BabyForm'

type View =
  | { kind: 'list' }
  | { kind: 'add' }
  | { kind: 'edit'; baby: Baby }
  | { kind: 'delete'; baby: Baby }

// 삭제 시 태그도 제거되므로 사진 목록·통계도 무효화(['days'] 접두).
function invalidateAfterDelete(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: babiesKey }),
    qc.invalidateQueries({ queryKey: ['assets'] }),
    qc.invalidateQueries({ queryKey: ['days'] }),
  ])
}

// 아기 추가 대화상자. 아기 없음 화면 공용.
export function AddBabyDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('babies.add')}</DialogTitle>
          <DialogDescription className="sr-only">
            {t('babies.formDescription')}
          </DialogDescription>
        </DialogHeader>
        <BabyForm
          onDone={() => {
            onOpenChange(false)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

// 아기 화면 ⋮ (보호자 이상). 목록에서 추가·수정·순서·삭제. 하위 화면은 같은 대화상자 안에서 전환.
export function BabyManager() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const babies = useBabies()
  const [view, setView] = useState<View | null>(null)

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
      toList()
    },
  })

  const list = babies.data ?? []

  function move(index: number, delta: -1 | 1) {
    const ids = list.map((b) => b.id)
    const target = ids[index + delta]
    const current = ids[index]
    if (target === undefined || current === undefined) return
    ids[index + delta] = current
    ids[index] = target
    reorder.mutate(ids)
  }

  function toList() {
    setView({ kind: 'list' })
    remove.reset()
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('babies.manage')}
        onClick={() => {
          setView({ kind: 'list' })
        }}
      >
        <IconMore aria-hidden className="size-6" />
      </Button>
      <Dialog
        open={view !== null}
        onOpenChange={(open) => {
          if (!open) {
            setView(null)
            remove.reset()
          }
        }}
      >
        <DialogContent>
          {view?.kind === 'list' && (
            <>
              <DialogHeader>
                <DialogTitle>{t('babies.manage')}</DialogTitle>
                <DialogDescription className="sr-only">
                  {t('babies.manageDescription')}
                </DialogDescription>
              </DialogHeader>
              <FormError error={reorder.error} />
              <ul className="grid max-h-[60dvh] gap-1 overflow-y-auto">
                {list.map((baby, i) => (
                  <li
                    key={baby.id}
                    className="flex min-w-0 items-center gap-2 py-1"
                  >
                    <Avatar baby={baby} size={40} />
                    <p className="min-w-0 flex-1 truncate font-semibold">
                      {baby.name}
                    </p>
                    <div className="flex shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t('babies.moveUp', { name: baby.name })}
                        disabled={i === 0 || reorder.isPending}
                        onClick={() => {
                          move(i, -1)
                        }}
                      >
                        <IconArrowUp aria-hidden />
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
                        <IconArrowDown aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t('babies.edit', { name: baby.name })}
                        onClick={() => {
                          setView({ kind: 'edit', baby })
                        }}
                      >
                        <IconEdit aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t('babies.delete', { name: baby.name })}
                        onClick={() => {
                          setView({ kind: 'delete', baby })
                        }}
                      >
                        <IconDelete aria-hidden />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
              <DialogFooter>
                <Button
                  onClick={() => {
                    setView({ kind: 'add' })
                  }}
                >
                  {t('babies.add')}
                </Button>
              </DialogFooter>
            </>
          )}
          {view?.kind === 'delete' && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {t('babies.deleteTitle', { name: view.baby.name })}
                </DialogTitle>
                <DialogDescription>
                  {t('babies.deleteConfirm')}
                </DialogDescription>
              </DialogHeader>
              <FormError error={remove.error} />
              <DialogFooter>
                <Button variant="outline" onClick={toList}>
                  {t('common.cancel')}
                </Button>
                <Button
                  variant="destructive"
                  disabled={remove.isPending}
                  onClick={() => {
                    remove.mutate(view.baby.id)
                  }}
                >
                  {t('common.delete')}
                </Button>
              </DialogFooter>
            </>
          )}
          {(view?.kind === 'add' || view?.kind === 'edit') && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {view.kind === 'add'
                    ? t('babies.add')
                    : t('babies.editTitle')}
                </DialogTitle>
                <DialogDescription className="sr-only">
                  {t('babies.formDescription')}
                </DialogDescription>
              </DialogHeader>
              <BabyForm
                key={view.kind === 'edit' ? view.baby.id : 'add'}
                baby={view.kind === 'edit' ? view.baby : undefined}
                onDone={toList}
              />
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
