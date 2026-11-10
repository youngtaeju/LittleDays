import IconWifiOff from '~icons/material-symbols/wifi-off-rounded'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { isNetworkDown, subscribeNetworkDown } from '@/api/client'
import { Button } from '@/components/ui/button'
import { PlainLayout } from '@/pages/PlainLayout'

// 브라우저 online/offline 이벤트 기준. 이벤트 시점의 값만 신뢰.
function useBrowserOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const on = () => {
      setOnline(true)
    }
    const off = () => {
      setOnline(false)
    }
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

// 브라우저 오프라인 또는 마지막 API 호출이 network.offline 일 때 상단 띠.
// status 영역은 항상 마운트, 내용만 교체. 새로 생긴 live region 은 알림 누락.
export function OfflineBanner() {
  const { t } = useTranslation()
  const online = useBrowserOnline()
  const networkDown = useSyncExternalStore(subscribeNetworkDown, isNetworkDown)
  return (
    <div role="status">
      {(!online || networkDown) && (
        <div className="flex items-center justify-center gap-2 bg-secondary px-4 py-1.5 text-[13px] text-secondary-foreground">
          <IconWifiOff className="size-4 shrink-0" aria-hidden />
          {t('offline.banner')}
        </div>
      )}
    </div>
  )
}

// me 를 모르고 캐시도 없을 때의 전체 화면.
export function OfflineScreen({ onRetry }: { onRetry: () => Promise<void> }) {
  const { t } = useTranslation()
  const [retrying, setRetrying] = useState(false)
  return (
    <PlainLayout title={t('offline.screen')} description={t('offline.hint')}>
      <Button
        disabled={retrying}
        onClick={() => {
          setRetrying(true)
          void onRetry().finally(() => {
            setRetrying(false)
          })
        }}
      >
        {t('common.retry')}
      </Button>
    </PlainLayout>
  )
}
