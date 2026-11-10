import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { AdaptiveSheet } from './AdaptiveSheet'
import { useUploadPicker } from './picker'
import { UploadQueue } from './UploadQueue'
import { uploadStore, useUploadStore } from './useUploadStore'

// 알약·예전 /upload 주소로 열림(셸이 열림 상태 관리). 다시 시도는 업로더 지연 로딩 후 실행.
export function UploadQueueSheet() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const items = useUploadStore()
  const picker = useUploadPicker()
  const resumable = items.some((i) => i.status === 'resumable')
  const retry = (id: string) => {
    import('./uploader').then(
      (m) => {
        m.getUploader(qc).retry(id)
      },
      () => {
        toast.error(t('errors.unknown'))
      },
    )
  }
  return (
    <AdaptiveSheet title={t('upload.queue')} onClose={uploadStore.closeQueue}>
      <div className="grid gap-4">
        {resumable && (
          <div className="grid gap-3 rounded-lg bg-muted p-3">
            <p className="text-sm">{t('upload.resumeHint')}</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={picker.resume}>{t('upload.repick')}</Button>
              <Button variant="outline" onClick={uploadStore.discardResumable}>
                {t('upload.discard')}
              </Button>
            </div>
          </div>
        )}
        <UploadQueue items={items} retry={retry} />
      </div>
    </AdaptiveSheet>
  )
}
