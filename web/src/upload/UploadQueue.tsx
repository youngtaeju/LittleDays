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
import { uploadStore, type UploadItem } from './useUploadStore'

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

function ViewLink({ assetId }: { assetId: string }) {
  const { t } = useTranslation()
  return (
    <Link
      to="/photo/$id"
      params={{ id: assetId }}
      className={buttonVariants({ variant: 'outline', size: 'sm' })}
    >
      {t('upload.view')}
    </Link>
  )
}

function RestoreButton({
  item,
  assetId,
}: {
  item: UploadItem
  assetId: string
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
}: {
  item: UploadItem
  retry: ((id: string) => void) | undefined
}) {
  const { t } = useTranslation()
  const { assetId } = item
  if (item.status === 'duplicate' && assetId) {
    return item.inTrash && !item.restored ? (
      <RestoreButton item={item} assetId={assetId} />
    ) : (
      <ViewLink assetId={assetId} />
    )
  }
  if (item.status === 'error' || item.status === 'lost') {
    return (
      <Button
        variant="outline"
        size="sm"
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
  const percent = Math.round(item.progress * 100)
  const failed =
    item.status === 'error' ||
    item.status === 'lost' ||
    item.status === 'unsupported'
  return (
    <li className="grid gap-2 border-b border-border py-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm">{item.name}</p>
          <p className="text-sm text-muted-foreground tabular-nums">
            {/* 상태 전환만 낭독. 진행률은 진행 막대가 전달. */}
            <span
              aria-live="polite"
              className={cn(failed && 'text-destructive')}
            >
              {statusText(t, item)}
            </span>
            {item.status === 'uploading' && ` ${String(percent)}%`}
          </p>
        </div>
        <Actions item={item} retry={retry} />
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
  return (
    <ul aria-label={t('upload.queue')}>
      {items.map((item) => (
        <Row key={item.id} item={item} retry={retry} />
      ))}
    </ul>
  )
}
