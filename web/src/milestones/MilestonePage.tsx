import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getRouteApi,
  Link,
  useCanGoBack,
  useRouter,
} from '@tanstack/react-router'
import IconBack from '~icons/material-symbols/arrow-back-rounded'
import IconMore from '~icons/material-symbols/more-vert-rounded'
import { DropdownMenu } from 'radix-ui'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api, call } from '@/api/client'
import { ApiError } from '@/api/errors'
import type { Baby, Milestone } from '@/api/types'
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
import { errorMessage } from '@/i18n'
import { formatAgeLine } from '@/lib/age'
import { formatDate } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useSettings } from '@/settings/useSettings'
import { Tile } from '@/timeline/Tile'
import { useBabies } from '@/timeline/useBabies'
import { milestoneLabel } from './labels'
import { MilestoneSheet } from './MilestoneSheet'
import { findPreset, rangeText } from './presets'
import { milestoneKey, milestoneQuery, milestonesKey } from './useMilestones'

const route = getRouteApi('/authed/shell/milestones/$id')

const MENU_ITEM =
  'flex min-h-11 cursor-default items-center gap-3 rounded-lg px-3 text-sm outline-none select-none data-[highlighted]:bg-accent'

// 처리 중 사진이 있으면 끝날 때까지 상세 재조회.
const POLL_MS = 5000

// 고치기, 지우기. 보호자 이상(남이 기록한 것 포함).
function MilestoneMenu({
  milestone,
  baby,
}: {
  milestone: Milestone
  baby: Baby | undefined
}) {
  const { t } = useTranslation()
  const router = useRouter()
  const canGoBack = useCanGoBack()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const remove = useMutation({
    mutationFn: () =>
      call(
        api.DELETE('/api/milestones/{id}', {
          params: { path: { id: milestone.id } },
        }),
      ),
    onSuccess: () => {
      setDeleting(false)
      void qc.invalidateQueries({ queryKey: milestonesKey(milestone.baby_id) })
      void qc.invalidateQueries({ queryKey: ['days'] })
      toast(t('milestones.deleted'))
      // 다시 열면 캐시 대신 서버 응답(404). 화면을 떠난 뒤 제거(남은 화면의 재조회 404 깜박임 방지).
      const unsubscribe = router.subscribe('onRendered', () => {
        unsubscribe()
        qc.removeQueries({ queryKey: milestoneKey(milestone.id) })
      })
      if (canGoBack) router.history.back()
      else {
        void router.navigate({
          to: '/babies/$id',
          params: { id: milestone.baby_id },
          replace: true,
        })
      }
    },
  })

  return (
    <>
      {/* 메뉴에서 시트, 대화상자를 여니 비모달. */}
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <Button variant="ghost" size="icon" aria-label={t('milestones.menu')}>
            <IconMore aria-hidden className="size-6" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={4}
            className="z-50 min-w-40 rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg"
          >
            {baby && (
              <DropdownMenu.Item
                className={MENU_ITEM}
                onSelect={() => {
                  setEditing(true)
                }}
              >
                {t('milestones.edit')}
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Item
              className={cn(MENU_ITEM, 'text-destructive')}
              onSelect={() => {
                remove.reset()
                setDeleting(true)
              }}
            >
              {t('milestones.delete')}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {editing && baby && (
        <MilestoneSheet
          baby={baby}
          milestone={milestone}
          onClose={() => {
            setEditing(false)
          }}
        />
      )}
      <Dialog open={deleting} onOpenChange={setDeleting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('milestones.deleteTitle')}</DialogTitle>
            <DialogDescription>
              {t('milestones.deleteDescription')}
            </DialogDescription>
          </DialogHeader>
          <FormError error={remove.error} />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleting(false)
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
              {t('milestones.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// /milestones/$id. 이름, 날짜와 그때 나이, 범위 안내, 메모, 붙인 사진 격자.
export function MilestonePage() {
  const { t, i18n } = useTranslation()
  const { id } = route.useParams()
  const router = useRouter()
  const canGoBack = useCanGoBack()
  const { user } = useMe()
  const timezone = useSettings()?.timezone
  const babies = useBabies().data
  const milestone = useQuery({
    ...milestoneQuery(id),
    refetchInterval: (q) =>
      !q.state.error &&
      q.state.data?.assets.some((a) => a.status === 'processing')
        ? POLL_MS
        : false,
  })
  // 다른 곳에서 지워진 마일스톤. 이전 응답이 남아 있어도 찾을 수 없음으로.
  const missing =
    milestone.error instanceof ApiError && milestone.error.status === 404
  const m = missing ? undefined : milestone.data
  const baby = m && babies?.find((b) => b.id === m.baby_id)

  let content
  if (m) {
    const age = baby ? formatAgeLine(t, baby.birth_date, m.achieved_on) : ''
    // 아기 둘 이상이면 누구의 나이인지 이름.
    const ageText =
      baby && age && (babies?.length ?? 0) > 1 ? `${baby.name} ${age}` : age
    const range = rangeText(t, findPreset(m.preset_key)?.range)
    content = (
      <>
        <div className="grid gap-1">
          <p className="text-sm wrap-anywhere text-muted-foreground tabular-nums">
            {[formatDate(m.achieved_on, i18n.language), ageText]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {range && (
            <p className="text-sm">{t('milestones.rangeNote', { range })}</p>
          )}
        </div>
        {m.note && (
          <p className="text-[15px] leading-normal wrap-anywhere whitespace-pre-wrap">
            {m.note}
          </p>
        )}
        {m.assets.length > 0 && (
          <ul
            aria-label={t('milestones.photoGrid')}
            className="-mx-4 grid grid-cols-3 gap-[2px] sm:grid-cols-4"
          >
            {m.assets.map((a) => (
              <li key={a.id}>
                <Tile item={a} from="milestone" of={m.id} timezone={timezone} />
              </li>
            ))}
          </ul>
        )}
      </>
    )
  } else if (milestone.isError) {
    content = (
      <div className="grid justify-items-start gap-3 py-4">
        <p className="text-sm">{errorMessage(t, milestone.error)}</p>
        {missing ? (
          <Button asChild>
            <Link to="/">{t('day.home')}</Link>
          </Button>
        ) : (
          <Button variant="outline" onClick={() => void milestone.refetch()}>
            {t('common.retry')}
          </Button>
        )}
      </div>
    )
  } else {
    content = (
      <p className="py-4 text-sm text-muted-foreground">
        {t('common.loading')}
      </p>
    )
  }

  return (
    <div className="-mt-4 grid grid-cols-1 gap-4 lg:mx-auto lg:max-w-[640px]">
      <header className="sticky top-0 z-10 -mx-4 flex min-h-14 items-center gap-1 bg-background px-2 py-1">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('milestones.back')}
          onClick={() => {
            if (canGoBack) router.history.back()
            else if (m) {
              void router.navigate({
                to: '/babies/$id',
                params: { id: m.baby_id },
                replace: true,
              })
            } else void router.navigate({ to: '/', replace: true })
          }}
        >
          <IconBack aria-hidden className="size-6" />
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-lg font-bold">
          {m ? milestoneLabel(t, m) : t('milestones.title')}
        </h1>
        {m && hasRole(user, 'guardian') && (
          <MilestoneMenu milestone={m} baby={baby} />
        )}
      </header>
      {content}
    </div>
  )
}
