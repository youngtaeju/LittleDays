import { useEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '@/api/errors'
import { Button } from '@/components/ui/button'
import IconArrowBack from '~icons/material-symbols/arrow-back-rounded'
import IconCheck from '~icons/material-symbols/check-rounded'
import IconClose from '~icons/material-symbols/close-rounded'

// 서버 규칙(server/src/auth/validate.rs)과 같은 값.
const PASSWORD_MIN = 8

export type FieldName =
  'instance_name' | 'display_name' | 'username' | 'password'

// 서버 에러 키가 가리키는 입력칸. 없으면 폼 전체 오류.
export function errorField(e: unknown): FieldName | null {
  if (!(e instanceof ApiError)) return null
  if (e.key === 'settings.instanceNameInvalid') return 'instance_name'
  if (e.key.startsWith('auth.username')) return 'username'
  if (e.key.startsWith('auth.password')) return 'password'
  if (e.key.startsWith('auth.displayName')) return 'display_name'
  return null
}

export function isPasswordMet(password: string): boolean {
  return Array.from(password).length >= PASSWORD_MIN
}

// 뒤로 버튼, 단계 점, 단계 안내(스크린리더 polite 알림).
export function StepBar({
  step,
  total,
  onBack,
}: {
  step: number
  total: number
  onBack?: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex h-11 items-center justify-between">
      {onBack ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('auth.wizard.back')}
          onClick={onBack}
        >
          <IconArrowBack className="size-5" />
        </Button>
      ) : (
        <span className="size-11" />
      )}
      <div
        role="img"
        aria-label={t('auth.wizard.stepOf', { step, total })}
        className="flex gap-2"
      >
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={`size-2 rounded-full ${i < step ? 'bg-primary' : 'bg-muted-foreground/40'}`}
          />
        ))}
      </div>
      <span className="size-11" />
      <p aria-live="polite" className="sr-only">
        {t('auth.wizard.stepOf', { step, total })}
      </p>
    </div>
  )
}

// 단계 제목. 마운트(단계 전환) 시 포커스 이동. 첫 단계는 입력칸 autoFocus 유지.
export function StepHeading({
  children,
  focusOnMount = true,
}: {
  children: ReactNode
  focusOnMount?: boolean
}) {
  const ref = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (focusOnMount) ref.current?.focus()
  }, [focusOnMount])
  return (
    <h1 ref={ref} tabIndex={-1} className="text-xl font-bold outline-none">
      {children}
    </h1>
  )
}

export function PasswordRules({ password }: { password: string }) {
  const { t } = useTranslation()
  const met = isPasswordMet(password)
  return (
    <>
      <ul className="grid gap-1 text-sm">
        <li
          data-met={met}
          className={`flex items-center gap-2 ${met ? 'text-foreground' : 'text-muted-foreground'}`}
        >
          {met ? (
            <IconCheck className="size-4 text-primary" aria-hidden />
          ) : (
            <IconClose className="size-4" aria-hidden />
          )}
          <span>{t('auth.wizard.passwordRuleLength')}</span>
        </li>
      </ul>
      <p role="status" className="sr-only">
        {met
          ? t('auth.wizard.passwordRulesMet')
          : t('auth.wizard.passwordRulesUnmet')}
      </p>
    </>
  )
}
