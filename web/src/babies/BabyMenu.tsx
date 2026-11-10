import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import IconArrowDown from '~icons/material-symbols/arrow-downward-rounded'
import IconArrowUp from '~icons/material-symbols/arrow-upward-rounded'
import IconMore from '~icons/material-symbols/more-vert-rounded'
import { DropdownMenu } from 'radix-ui'
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
import { cn } from '@/lib/utils'
import { babiesKey, useBabies } from '@/timeline/useBabies'
import { AdaptiveSheet } from '@/upload/AdaptiveSheet'
import { Avatar } from './Avatar'
import { BabyEditSheet } from './BabyEditSheet'

const MENU_ITEM =
  'flex min-h-11 cursor-default items-center gap-3 rounded-lg px-3 text-sm outline-none select-none data-[highlighted]:bg-accent'

// 위아래 이동. 낙관적 반영 후 실패 시 되돌림.
function ReorderSheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const list = useBabies().data ?? []

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

  function move(index: number, delta: -1 | 1) {
    const ids = list.map((b) => b.id)
    const target = ids[index + delta]
    const current = ids[index]
    if (target === undefined || current === undefined) return
    ids[index + delta] = current
    ids[index] = target
    reorder.mutate(ids)
  }

  return (
    <AdaptiveSheet title={t('babies.reorder')} onClose={onClose}>
      <FormError error={reorder.error} />
      <ul className="grid gap-1">
        {list.map((baby, i) => (
          <li key={baby.id} className="flex min-w-0 items-center gap-2 py-1">
            <Avatar baby={baby} size={40} />
            <p className="min-w-0 flex-1 truncate font-semibold">{baby.name}</p>
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
            </div>
          </li>
        ))}
      </ul>
    </AdaptiveSheet>
  )
}

function DeleteDialog({
  baby,
  open,
  onOpenChange,
}: {
  baby: Baby
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const remove = useMutation({
    mutationFn: () =>
      call(
        api.DELETE('/api/babies/{id}', { params: { path: { id: baby.id } } }),
      ),
    onSuccess: async () => {
      // 목록에서 바로 빼면 아기 화면이 /babies 로 넘김(남은 아기 또는 아기 없음 화면).
      qc.setQueryData<Baby[]>(babiesKey, (prev) =>
        prev?.filter((b) => b.id !== baby.id),
      )
      // 태그도 제거되므로 사진 목록·통계도 무효화(['days'] 접두).
      await Promise.all([
        qc.invalidateQueries({ queryKey: babiesKey }),
        qc.invalidateQueries({ queryKey: ['assets'] }),
        qc.invalidateQueries({ queryKey: ['days'] }),
      ])
    },
  })
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) remove.reset()
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('babies.deleteTitle', { name: baby.name })}
          </DialogTitle>
          <DialogDescription>{t('babies.deleteConfirm')}</DialogDescription>
        </DialogHeader>
        <FormError error={remove.error} />
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false)
            }}
          >
            {t('common.cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => {
              remove.mutate()
            }}
          >
            {t('babies.deleteSubmit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// 아기 화면 ⋮ (보호자 이상). 고치기·추가·순서(2명 이상)·삭제.
export function BabyMenu({ baby, count }: { baby: Baby; count: number }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [open, setOpen] = useState<
    'edit' | 'add' | 'reorder' | 'delete' | null
  >(null)
  const close = () => {
    setOpen(null)
  }

  return (
    <>
      {/* 메뉴에서 시트·대화상자를 여니 비모달(닫힌 메뉴가 포커스·포인터 잠금을 남기지 않게). */}
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <Button variant="ghost" size="icon" aria-label={t('babies.menu')}>
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
              className={MENU_ITEM}
              onSelect={() => {
                setOpen('edit')
              }}
            >
              {t('babies.editTitle')}
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className={MENU_ITEM}
              onSelect={() => {
                setOpen('add')
              }}
            >
              {t('babies.add')}
            </DropdownMenu.Item>
            {count > 1 && (
              <DropdownMenu.Item
                className={MENU_ITEM}
                onSelect={() => {
                  setOpen('reorder')
                }}
              >
                {t('babies.reorder')}
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Item
              className={cn(MENU_ITEM, 'text-destructive')}
              onSelect={() => {
                setOpen('delete')
              }}
            >
              {t('babies.deleteBaby')}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {open === 'edit' && <BabyEditSheet baby={baby} onClose={close} />}
      {open === 'add' && (
        <BabyEditSheet
          onClose={close}
          onSaved={(saved) => {
            void navigate({ to: '/babies/$id', params: { id: saved.id } })
          }}
        />
      )}
      {open === 'reorder' && <ReorderSheet onClose={close} />}
      <DeleteDialog
        baby={baby}
        open={open === 'delete'}
        onOpenChange={(next) => {
          setOpen(next ? 'delete' : null)
        }}
      />
    </>
  )
}
