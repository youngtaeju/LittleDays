import { Navigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { hasRole, useMe } from '@/auth/session'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/i18n'
import { useSettingsQuery } from '@/settings/useSettings'
import { useBabies } from '@/timeline/useBabies'
import { BabyEditSheet } from './BabyEditSheet'
import { pickBaby } from './lastBaby'

// /babies. 아기가 있으면 라우트가 아기 화면으로 넘김. 여기는 아기 없음·조회 실패.
export function BabiesIndexPage() {
  const { t } = useTranslation()
  const { user } = useMe()
  const babies = useBabies()
  const [adding, setAdding] = useState(false)
  const settings = useSettingsQuery()
  // 설정 확정 전엔 이동 보류(usePrimaryBaby 와 같은 규칙). 설정 조회 실패면 첫째.
  const settled = settings.data !== undefined || settings.isError
  const target =
    babies.data &&
    settled &&
    pickBaby(babies.data, settings.data?.primary_baby_id)

  // 추가 직후 또는 조회 실패 후 다시 받은 목록.
  if (target) {
    return <Navigate to="/babies/$id" params={{ id: target.id }} replace />
  }
  if (babies.isError) {
    return (
      <div className="grid justify-items-start gap-3 py-4">
        <p className="text-sm">{errorMessage(t, babies.error)}</p>
        <Button variant="outline" onClick={() => void babies.refetch()}>
          {t('common.retry')}
        </Button>
      </div>
    )
  }
  if (!babies.data || (babies.data.length > 0 && !settled)) {
    return (
      <p className="py-4 text-sm text-muted-foreground">
        {t('common.loading')}
      </p>
    )
  }
  return (
    <div className="grid justify-items-center gap-2 py-16 text-center">
      <h1 className="sr-only">{t('nav.babies')}</h1>
      {hasRole(user, 'guardian') ? (
        <>
          <p className="text-base font-semibold">{t('babies.emptyManage')}</p>
          <Button
            className="mt-2"
            onClick={() => {
              setAdding(true)
            }}
          >
            {t('babies.add')}
          </Button>
          {adding && (
            <BabyEditSheet
              onClose={() => {
                setAdding(false)
              }}
            />
          )}
        </>
      ) : (
        <p>{t('babies.empty')}</p>
      )}
    </div>
  )
}
