import { useTranslation } from 'react-i18next'
import type { Baby } from '@/api/types'
import { AdaptiveSheet } from '@/upload/AdaptiveSheet'
import { BabyForm } from './BabyForm'

// baby 있으면 아기 정보 고치기, 없으면 아기 추가. 저장하면 닫힘.
export function BabyEditSheet({
  baby,
  onClose,
  onSaved,
}: {
  baby?: Baby
  onClose: () => void
  onSaved?: (saved: Baby) => void
}) {
  const { t } = useTranslation()
  return (
    <AdaptiveSheet
      title={baby ? t('babies.editTitle') : t('babies.add')}
      onClose={onClose}
    >
      <BabyForm
        baby={baby}
        onDone={(saved) => {
          onClose()
          onSaved?.(saved)
        }}
      />
    </AdaptiveSheet>
  )
}
