import IconAdd from '~icons/material-symbols/add-rounded'
import { useTranslation } from 'react-i18next'
import { useUploadPicker } from '@/upload/picker'

// 하단 탭 가운데 (+). 기기 사진 선택창 바로 열기. 진행 상황은 업로드 알약.
export function AddButton() {
  const { t } = useTranslation()
  const { open } = useUploadPicker()
  return (
    <button
      type="button"
      aria-label={t('nav.add')}
      onClick={open}
      className="grid size-11 place-items-center rounded-full bg-primary text-primary-foreground shadow-md"
    >
      <IconAdd aria-hidden className="size-7" />
    </button>
  )
}
