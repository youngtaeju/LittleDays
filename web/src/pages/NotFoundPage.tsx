import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { AuthLayout } from './AuthLayout'

export function NotFoundPage() {
  const { t } = useTranslation()
  return (
    <AuthLayout title={t('notFound.title')}>
      <Link to="/" className="text-sm font-semibold text-accent-ink underline">
        {t('notFound.home')}
      </Link>
    </AuthLayout>
  )
}
