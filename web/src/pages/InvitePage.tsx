import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api, call } from '@/api/client'
import { ApiError } from '@/api/errors'
import { setSignedIn } from '@/auth/session'
import { Field, FormError } from '@/components/Field'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/i18n'
import { AuthLayout } from './AuthLayout'
import {
  errorField,
  PasswordRules,
  StepBar,
  StepHeading,
  type FieldName,
} from './authParts'

const TOTAL_STEPS = 2
const INVALID_LINK_KEYS = ['expired', 'used', 'revoked', 'notFound'] as const

// 미리보기 실패 중 이유별 문구가 있는 서버 키(invite.*). 없으면 null.
function invalidLinkReason(
  e: unknown,
): (typeof INVALID_LINK_KEYS)[number] | null {
  if (!(e instanceof ApiError)) return null
  return INVALID_LINK_KEYS.find((k) => e.key === `invite.${k}`) ?? null
}

export function InvitePage() {
  const { t, i18n } = useTranslation()
  const { raw } = useParams({ from: '/invite/$raw' })
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [step, setStep] = useState<1 | 2>(1)
  const [values, setValues] = useState({
    display_name: '',
    username: '',
    password: '',
  })
  const [fieldError, setFieldError] = useState<{
    field: FieldName
    error: unknown
  } | null>(null)
  const body = useRef<HTMLDivElement>(null)
  const preview = useQuery({
    queryKey: ['invite', raw],
    queryFn: () =>
      call(
        api.GET('/api/invites/{raw}/preview', { params: { path: { raw } } }),
      ),
  })
  const accept = useMutation({
    mutationFn: async () => {
      const { user } = await call(
        api.POST('/api/invites/{raw}/accept', {
          params: { path: { raw } },
          body: values,
        }),
      )
      // 서버는 인스턴스 기본 언어로 생성. 고른 언어로 1회 맞춤.
      const lng = i18n.language
      if (lng === user.locale) return user
      return call(api.PATCH('/api/users/me', { body: { locale: lng } })).then(
        (r) => r.user,
        // 언어 맞춤 실패는 무시. 가입은 완료 상태.
        () => user,
      )
    },
    onSuccess: async (user) => {
      setSignedIn(qc, user)
      toast(t('auth.invite.welcome', { instance: preview.data?.instance_name }))
      await navigate({ to: '/' })
    },
    onError: (e) => {
      const field = errorField(e)
      if (!field) return
      setFieldError({ field, error: e })
      setStep(field === 'display_name' ? 1 : 2)
    },
  })

  // 서버 오류가 가리키는 입력칸으로 포커스. 단계 전환 렌더 뒤에 실행.
  useEffect(() => {
    if (!fieldError) return
    body.current
      ?.querySelector<HTMLInputElement>(`[name="${fieldError.field}"]`)
      ?.focus()
  }, [fieldError])

  function set(name: keyof typeof values) {
    return {
      name,
      value: values[name],
      onChange: (e: ChangeEvent<HTMLInputElement>) => {
        const { value } = e.currentTarget
        setValues((v) => ({ ...v, [name]: value }))
        if (fieldError?.field === name) setFieldError(null)
      },
    }
  }

  function errorOf(field: FieldName): string | null {
    return fieldError?.field === field
      ? errorMessage(t, fieldError.error)
      : null
  }

  if (preview.isPending) return <AuthLayout title={t('common.loading')} />
  // 미리보기 실패 또는 입력 중 링크 무효화(만료·회수·동시 사용).
  const linkError = preview.isError
    ? preview.error
    : invalidLinkReason(accept.error)
      ? accept.error
      : null
  if (linkError) {
    const reason = invalidLinkReason(linkError)
    return (
      <AuthLayout
        title={
          reason
            ? t(`auth.invite.error.${reason}.title`)
            : errorMessage(t, linkError)
        }
        description={reason ? t(`auth.invite.error.${reason}.action`) : null}
      >
        <Link
          to="/login"
          className="text-sm font-semibold text-accent-ink underline"
        >
          {t('auth.toLogin')}
        </Link>
      </AuthLayout>
    )
  }

  if (!preview.data) return <AuthLayout title={t('common.loading')} />
  const { instance_name, inviter_display_name, role } = preview.data
  return (
    <AuthLayout>
      <div className="grid gap-6">
        <StepBar
          step={step}
          total={TOTAL_STEPS}
          onBack={
            step === 2
              ? () => {
                  setStep(1)
                }
              : undefined
          }
        />
        <div ref={body}>
          {step === 1 && (
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                setFieldError(null)
                setStep(2)
              }}
            >
              <div className="grid gap-1">
                <StepHeading focusOnMount={false}>
                  {t('auth.invite.title', {
                    inviter: inviter_display_name,
                    instance: instance_name,
                  })}
                </StepHeading>
                <p className="text-sm text-muted-foreground">
                  {t(`roles.${role}Desc`)}
                </p>
              </div>
              <Field
                label={t('auth.displayName')}
                autoComplete="nickname"
                maxLength={64}
                required
                autoFocus
                error={errorOf('display_name')}
                {...set('display_name')}
              />
              <Button type="submit">{t('auth.invite.next')}</Button>
            </form>
          )}

          {step === 2 && (
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                accept.mutate()
              }}
            >
              <div className="grid gap-1">
                <StepHeading>{t('auth.invite.accountTitle')}</StepHeading>
                <p className="text-sm text-muted-foreground">
                  {t('auth.invite.accountHint')}
                </p>
              </div>
              <Field
                label={t('auth.username')}
                hint={t('auth.wizard.usernameHint')}
                autoComplete="username"
                autoCapitalize="none"
                required
                error={errorOf('username')}
                {...set('username')}
              />
              <Field
                label={t('auth.password')}
                type="password"
                autoComplete="new-password"
                required
                error={errorOf('password')}
                {...set('password')}
              />
              <PasswordRules password={values.password} />
              {fieldError === null && <FormError error={accept.error} />}
              <Button type="submit" disabled={accept.isPending}>
                {t('auth.invite.submit')}
              </Button>
            </form>
          )}
        </div>
      </div>
    </AuthLayout>
  )
}
