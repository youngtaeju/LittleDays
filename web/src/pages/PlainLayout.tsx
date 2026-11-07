import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

// 셸 없는 화면(로그인·가입·초대·없는 경로) 공용.
export function PlainLayout({
  title,
  description,
  children,
}: {
  title: string
  description?: ReactNode
  children?: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-12">
      <p className="text-sm font-semibold text-primary">{t('app.name')}</p>
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold">{title}</h1>
        {description && (
          <div className="text-sm text-muted-foreground">{description}</div>
        )}
      </div>
      {children}
    </main>
  )
}
