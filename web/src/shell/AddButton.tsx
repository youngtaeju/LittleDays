import IconAdd from '~icons/material-symbols/add-rounded'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useUploadPicker } from '@/upload/picker'
import { useActiveUploadCount } from '@/upload/useUploadStore'

// 진행 중 업로드 개수 포함 이름. 숫자 뱃지는 시각용.
export function useAddLabel(): { label: string; count: number } {
  const { t } = useTranslation()
  const count = useActiveUploadCount()
  const label = t('nav.add')
  return {
    label: count ? `${label}, ${t('upload.inProgress', { count })}` : label,
    count,
  }
}

export function UploadCountBadge({
  count,
  className,
}: {
  count: number
  className?: string
}) {
  if (!count) return null
  return (
    <span
      aria-hidden
      className={cn(
        'min-w-5 rounded-full bg-foreground px-1.5 text-center text-2xs leading-5 font-semibold text-background tabular-nums',
        className,
      )}
    >
      {count}
    </span>
  )
}

// 하단 탭 가운데 (+). 기기 사진 선택창 바로 열기.
export function AddButton() {
  const { open } = useUploadPicker()
  const { label, count } = useAddLabel()
  return (
    <button
      type="button"
      aria-label={label}
      onClick={open}
      className="relative grid size-11 place-items-center rounded-full bg-primary text-primary-foreground shadow-md"
    >
      <IconAdd aria-hidden className="size-7" />
      <UploadCountBadge count={count} className="absolute -top-1 -right-1.5" />
    </button>
  )
}
