import type { ReactNode } from 'react'
import { QueryClientContext } from '@tanstack/react-query'
import { useContext } from 'react'
import { useTranslation } from 'react-i18next'
import { meQueryKey } from '@/auth/session'
import { chooseLocale, type Locale } from '@/i18n'
import { cn } from '@/lib/utils'

const LANGUAGES: { lng: Locale; label: string }[] = [
  { lng: 'ko', label: '한국어' },
  { lng: 'en', label: 'English' },
]

// 셸 없는 화면(로그인·가입·초대·없는 경로) 공용. 휴대폰 한 열, 1024px 이상 가운데 400px.
export function AuthLayout({
  title,
  description,
  children,
}: {
  title?: string
  description?: ReactNode
  children?: ReactNode
}) {
  const { t, i18n } = useTranslation()
  // 조회 없이 캐시만 확인(프로바이더 밖 렌더 허용). 로그인 상태면 계정 언어가 우선이라 전환 숨김.
  const signedIn =
    useContext(QueryClientContext)?.getQueryData(meQueryKey) != null
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col px-4 py-6 lg:max-w-[400px]">
      <header className="flex items-center gap-2">
        <img src="/icon.svg" alt="" className="size-7 rounded-md" />
        <span className="text-sm font-semibold text-accent-ink">
          {t('app.name')}
        </span>
      </header>
      <div className="flex flex-1 flex-col gap-6 pb-10 pt-12">
        {(title || description) && (
          <div className="grid gap-1">
            {title && <h1 className="text-xl font-bold">{title}</h1>}
            {description && (
              <div className="text-sm text-muted-foreground">{description}</div>
            )}
          </div>
        )}
        {children}
      </div>
      {!signedIn && (
        <footer
          role="group"
          aria-label={t('auth.language')}
          className="flex justify-center gap-1"
        >
          {LANGUAGES.map(({ lng, label }) => (
            <button
              key={lng}
              type="button"
              lang={lng}
              aria-pressed={i18n.language === lng}
              onClick={() => {
                chooseLocale(lng)
              }}
              className={cn(
                'min-h-11 rounded-lg px-3 text-sm',
                i18n.language === lng
                  ? 'font-semibold text-foreground'
                  : 'text-muted-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </footer>
      )}
    </main>
  )
}
