import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useRegisterSW } from 'virtual:pwa-register/react'

const TOAST_ID = 'pwa-update'

// 새 서비스 워커 대기 시 새로고침 안내. 누르면 대기 워커 활성화 후 새로고침.
export function UpdatePrompt() {
  const { t } = useTranslation()
  const [registration, setRegistration] = useState<ServiceWorkerRegistration>()
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, r) {
      setRegistration(r)
    },
  })

  // 설치형 앱은 백그라운드 복귀 시 새로 로드되지 않음. 보일 때마다 새 버전 확인.
  useEffect(() => {
    if (!registration) return
    const check = () => {
      if (document.visibilityState !== 'visible') return
      // 오프라인 등 실패는 다음 기회에.
      registration.update().catch(() => undefined)
    }
    document.addEventListener('visibilitychange', check)
    return () => {
      document.removeEventListener('visibilitychange', check)
    }
  }, [registration])

  useEffect(() => {
    if (!needRefresh) return
    toast(t('pwa.updateAvailable'), {
      id: TOAST_ID,
      duration: Infinity,
      action: {
        label: t('pwa.reload'),
        onClick: () => {
          void updateServiceWorker()
        },
      },
    })
  }, [needRefresh, t, updateServiceWorker])

  return null
}
