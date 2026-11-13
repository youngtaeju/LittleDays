import { useMutation, useQueryClient } from '@tanstack/react-query'
import IconLibrary from '~icons/material-symbols/photo-library-outline-rounded'
import IconUpload from '~icons/material-symbols/upload-rounded'
import { useState, type ComponentType, type SVGProps } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api, call } from '@/api/client'
import { errorMessage } from '@/i18n'
import { AssetPickerSheet } from '@/stories/AssetPickerSheet'
import { AdaptiveSheet } from '@/upload/AdaptiveSheet'
import { useUploadPicker } from '@/upload/picker'
import { albumsKeyRoot } from './useAlbums'

const OPTION =
  'flex min-h-14 w-full items-center gap-4 rounded-xl px-3 text-left text-[15px] font-semibold outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring'

// 사진 추가 시트. 올린 사진 고르기(고른 것만 넣기) / 새로 올리기(업로드 확인 시트 + 앨범 대상).
export function AddPhotosSheet({
  albumId,
  onClose,
}: {
  albumId: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const picker = useUploadPicker()
  const [picking, setPicking] = useState(false)

  // 시트를 닫은 뒤 완료. 화면을 떠나도 알림과 무효화는 훅 옵션 쪽이라 실행.
  const add = useMutation({
    mutationFn: (ids: string[]) =>
      call(
        api.POST('/api/albums/{id}/assets', {
          params: { path: { id: albumId } },
          body: { asset_ids: ids },
        }),
      ),
    onSuccess: (_, ids) => {
      void qc.invalidateQueries({ queryKey: albumsKeyRoot })
      toast(t('albums.added', { count: ids.length }))
    },
    onError: (e) => {
      toast.error(errorMessage(t, e))
    },
  })

  if (picking) {
    return (
      <AssetPickerSheet
        selected={[]}
        onClose={onClose}
        onDone={(assets) => {
          onClose()
          if (assets.length > 0) add.mutate(assets.map((a) => a.id))
        }}
      />
    )
  }

  const options: {
    key: string
    label: string
    icon: ComponentType<SVGProps<SVGSVGElement>>
    run: () => void
  }[] = [
    {
      key: 'pick',
      label: t('albums.pickUploaded'),
      icon: IconLibrary,
      run: () => {
        setPicking(true)
      },
    },
    {
      key: 'upload',
      label: t('albums.uploadNew'),
      icon: IconUpload,
      // 선택창은 누른 그 이벤트 안에서 열어야 휴대폰 브라우저가 허용.
      run: () => {
        picker.open({ attach: { kind: 'album', id: albumId } })
        onClose()
      },
    },
  ]

  return (
    <AdaptiveSheet title={t('albums.addPhotos')} onClose={onClose}>
      <ul className="-mx-2 grid gap-1">
        {options.map(({ key, label, icon: Icon, run }) => (
          <li key={key}>
            <button type="button" className={OPTION} onClick={run}>
              <span
                aria-hidden
                className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-ink"
              >
                <Icon className="size-6" />
              </span>
              {label}
            </button>
          </li>
        ))}
      </ul>
    </AdaptiveSheet>
  )
}
