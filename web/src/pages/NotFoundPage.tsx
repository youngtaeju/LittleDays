import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { PlainLayout } from './PlainLayout'

export function NotFoundPage() {
  const { t } = useTranslation()
  return (
    <PlainLayout title={t('notFound.title')}>
      <Link to="/" className="text-sm font-semibold text-accent-ink underline">
        {t('notFound.home')}
      </Link>
    </PlainLayout>
  )
}
