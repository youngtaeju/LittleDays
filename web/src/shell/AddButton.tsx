import IconAdd from '~icons/material-symbols/add-rounded'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AddSheet } from './AddSheet'

// 하단 탭 가운데 (+). 추가 시트 열기. 사진 진행 상황은 업로드 알약.
export function AddButton() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        aria-label={t('addSheet.open')}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(true)
        }}
        className="grid size-11 place-items-center rounded-full bg-primary text-primary-foreground shadow-md"
      >
        <IconAdd aria-hidden className="size-7" />
      </button>
      <AddSheet open={open} onOpenChange={setOpen} />
    </>
  )
}
