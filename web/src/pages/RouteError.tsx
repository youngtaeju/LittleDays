import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { AuthLayout } from './AuthLayout'

// 지연 청크 404(배포 후 구 해시) 등. 전체 새로고침으로 새 index.html 확보.
export function RouteError() {
  const { t } = useTranslation()
  return (
    <AuthLayout
      title={t('routeError.title')}
      description={t('routeError.hint')}
    >
      <Button
        onClick={() => {
          window.location.reload()
        }}
      >
        {t('routeError.reload')}
      </Button>
    </AuthLayout>
  )
}

export function RoutePending() {
  const { t } = useTranslation()
  return (
    <p role="status" className="p-6 text-sm text-muted-foreground">
      {t('common.loading')}
    </p>
  )
}
