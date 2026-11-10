import { useId } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api, call } from '@/api/client'
import { isLogoutError } from '@/api/errors'
import { Button, buttonVariants } from '@/components/ui/button'
import { errorMessage } from '@/i18n'
import { cn } from '@/lib/utils'
import { applyAsset } from '@/viewer/useAsset'
import {
  isActive,
  isFailed,
  uploadStore,
  type UploadItem,
} from './useUploadStore'

function statusText(
  t: ReturnType<typeof useTranslation>['t'],
  item: UploadItem,
): string {
  switch (item.status) {
    case 'duplicate':
      if (item.restored) return t('upload.restored')
      return item.inTrash
        ? t('upload.status.inTrash')
        : t('upload.status.duplicate')
    case 'error':
      return errorMessage(t, item.error)
    default:
      return t(`upload.status.${item.status}`)
  }
}

function ViewLink({ assetId, nameId }: { assetId: string; nameId: string }) {
  const { t } = useTranslation()
  return (
    <Link
      to="/photos/$id"
      params={{ id: assetId }}
      aria-describedby={nameId}
      className={buttonVariants({ variant: 'outline', size: 'sm' })}
    >
      {t('upload.view')}
    </Link>
  )
}

function RestoreButton({
  item,
  assetId,
  nameId,
}: {
  item: UploadItem
  assetId: string
  nameId: string
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const restore = useMutation({
    mutationFn: () =>
      call(
        api.POST('/api/assets/{id}/restore', {
          params: { path: { id: assetId } },
        }),
      ),
    onSuccess: (a) => {
      uploadStore.patch(item.id, { restored: true })
      applyAsset(qc, a)
      void qc.invalidateQueries({ queryKey: ['trash'] })
    },
    onError: (e) => {
      if (!isLogoutError(e)) toast.error(errorMessage(t, e))
    },
  })
  return (
    <Button
      variant="outline"
      size="sm"
      aria-describedby={nameId}
      disabled={restore.isPending}
      onClick={() => {
        restore.mutate()
      }}
    >
      {t('upload.restore')}
    </Button>
  )
}

function Actions({
  item,
  retry,
  nameId,
}: {
  item: UploadItem
  retry: ((id: string) => void) | undefined
  nameId: string
}) {
  const { t } = useTranslation()
  const { assetId } = item
  if (item.status === 'duplicate' && assetId) {
    return item.inTrash && !item.restored ? (
      <RestoreButton item={item} assetId={assetId} nameId={nameId} />
    ) : (
      <ViewLink assetId={assetId} nameId={nameId} />
    )
  }
  if (item.status === 'error' || item.status === 'lost') {
    return (
      <Button
        variant="outline"
        size="sm"
        aria-describedby={nameId}
        disabled={!retry}
        onClick={() => retry?.(item.id)}
      >
        {item.status === 'lost' ? t('upload.reupload') : t('common.retry')}
      </Button>
    )
  }
  return null
}

function Row({
  item,
  retry,
}: {
  item: UploadItem
  retry: ((id: string) => void) | undefined
}) {
  const { t } = useTranslation()
  const nameId = useId()
  const percent = Math.round(item.progress * 100)
  const failed = isFailed(item.status)
  return (
    <li className="grid gap-2 border-b border-border py-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p id={nameId} className="truncate text-sm">
            {item.name}
          </p>
          <p className="text-sm text-muted-foreground tabular-nums">
            <span className={cn(failed && 'text-destructive')}>
              {statusText(t, item)}
            </span>
            {item.status === 'uploading' && ` ${String(percent)}%`}
          </p>
        </div>
        <Actions item={item} retry={retry} nameId={nameId} />
      </div>
      {item.status === 'uploading' && (
        <div
          role="progressbar"
          aria-label={item.name}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-1 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full bg-primary transition-[width] motion-reduce:transition-none"
            style={{ width: `${String(percent)}%` }}
          />
        </div>
      )}
    </li>
  )
}

// retry 없음 = 업로더 로딩 전.
export function UploadQueue({
  items,
  retry,
}: {
  items: readonly UploadItem[]
  retry: ((id: string) => void) | undefined
}) {
  const { t } = useTranslation()
  // 이어올리기 대기는 완료·실패 어느 쪽도 아님.
  const settled = items.filter(
    (i) => !isActive(i.status) && i.status !== 'resumable',
  ).length
  const failed = items.filter((i) => isFailed(i.status)).length
  return (
    <div>
      {/* 큐 전체 낭독 하나. 행별 상태·진행률은 낭독하지 않음. */}
      <p role="status" className="text-sm text-muted-foreground">
        {t('upload.summary', { total: items.length, done: settled })}
        {failed > 0 && t('upload.summaryFailed', { failed })}
      </p>
      <ul aria-label={t('upload.queue')}>
        {items.map((item) => (
          <Row key={item.id} item={item} retry={retry} />
        ))}
      </ul>
    </div>
  )
}
