import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type SyntheticEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
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

const TOTAL_STEPS = 4
type Step = 1 | 2 | 3 | 4

// 1~2단계 가입 API, 3단계 아기 추가 API. 2단계 성공 뒤에는 1~2단계로 되돌아가지 않음.
export function SignupWizard() {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>(1)
  const [babyFailed, setBabyFailed] = useState(false)
  const [values, setValues] = useState({
    instance_name: '',
    display_name: '',
    username: '',
    password: '',
    babyName: '',
    babyBirth: '',
  })
  const [fieldError, setFieldError] = useState<{
    field: FieldName
    error: unknown
  } | null>(null)
  const body = useRef<HTMLDivElement>(null)

  // 서버 오류가 가리키는 입력칸으로 포커스. 단계 전환 렌더 뒤에 실행.
  useEffect(() => {
    if (!fieldError) return
    body.current
      ?.querySelector<HTMLInputElement>(`[name="${fieldError.field}"]`)
      ?.focus()
  }, [fieldError])

  const signup = useMutation({
    mutationFn: async () => {
      const { user } = await call(
        api.POST('/api/auth/signup', {
          body: {
            username: values.username,
            display_name: values.display_name,
            password: values.password,
            instance_name: values.instance_name,
          },
        }),
      )
      // 서버는 owner 언어를 ko 로 생성. 가입 화면에서 고른 언어로 1회 맞춤.
      const lng = i18n.language
      if (lng === user.locale) return user
      return call(api.PATCH('/api/users/me', { body: { locale: lng } })).then(
        (r) => r.user,
        // 언어 맞춤 실패는 무시. 가입은 완료 상태.
        () => user,
      )
    },
    onSuccess: (user) => {
      setSignedIn(qc, user)
      setFieldError(null)
      setStep(3)
    },
    onError: (e) => {
      const field = errorField(e)
      if (!field) return
      setFieldError({ field, error: e })
      setStep(field === 'instance_name' ? 1 : 2)
    },
  })

  const addBaby = useMutation({
    mutationFn: () =>
      call(
        api.POST('/api/babies', {
          body: { name: values.babyName, birth_date: values.babyBirth },
        }),
      ),
    onError: () => {
      setBabyFailed(true)
    },
    // 성공·실패 모두 완료 화면으로.
    onSettled: () => {
      setStep(4)
    },
  })

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

  function submit(e: SyntheticEvent, onValid: () => void) {
    e.preventDefault()
    onValid()
  }

  const canGoBack = step === 2

  return (
    <AuthLayout>
      <div className="grid gap-6">
        <StepBar
          step={step}
          total={TOTAL_STEPS}
          onBack={
            canGoBack
              ? () => {
                  setStep((x) => (x - 1) as Step)
                }
              : undefined
          }
        />

        <div ref={body}>
          {step === 1 && (
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                submit(e, () => {
                  setFieldError(null)
                  setStep(2)
                })
              }}
            >
              <StepHeading focusOnMount={false}>
                {t('auth.wizard.instanceTitle')}
              </StepHeading>
              <Field
                label={t('auth.wizard.instanceName')}
                hint={t('auth.wizard.instanceHint')}
                placeholder={t('auth.wizard.instancePlaceholder')}
                maxLength={64}
                required
                autoFocus
                error={errorOf('instance_name')}
                {...set('instance_name')}
              />
              <Button type="submit">{t('auth.wizard.next')}</Button>
            </form>
          )}

          {step === 2 && (
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                submit(e, () => {
                  signup.mutate()
                })
              }}
            >
              <div className="grid gap-1">
                <StepHeading>{t('auth.wizard.accountTitle')}</StepHeading>
                <p className="text-sm text-muted-foreground">
                  {t('auth.wizard.accountHint')}
                </p>
              </div>
              <Field
                label={t('auth.displayName')}
                autoComplete="nickname"
                maxLength={64}
                required
                error={errorOf('display_name')}
                {...set('display_name')}
              />
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
              {fieldError === null && <FormError error={signup.error} />}
              {signup.error instanceof ApiError &&
                signup.error.key === 'auth.signupClosed' && (
                  <Link
                    to="/login"
                    className="text-sm font-semibold text-accent-ink underline"
                  >
                    {t('auth.wizard.toLogin')}
                  </Link>
                )}
              <Button type="submit" disabled={signup.isPending}>
                {t('auth.wizard.createAccount')}
              </Button>
            </form>
          )}

          {step === 3 && (
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                submit(e, () => {
                  addBaby.mutate()
                })
              }}
            >
              <StepHeading>{t('auth.wizard.babyTitle')}</StepHeading>
              <Field
                label={t('auth.wizard.babyName')}
                hint={t('auth.wizard.babyNameHint')}
                maxLength={64}
                required
                {...set('babyName')}
              />
              <Field
                label={t('auth.wizard.babyBirth')}
                type="date"
                required
                {...set('babyBirth')}
              />
              <Button type="submit" disabled={addBaby.isPending}>
                {t('auth.wizard.next')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={addBaby.isPending}
                onClick={() => {
                  setStep(4)
                }}
              >
                {t('auth.wizard.skip')}
              </Button>
            </form>
          )}

          {step === 4 && (
            <div className="grid gap-4">
              <StepHeading>{t('auth.wizard.doneTitle')}</StepHeading>
              <p className="text-sm text-muted-foreground">
                {t('auth.wizard.doneBody', { instance: values.instance_name })}
              </p>
              {babyFailed && (
                <p role="status" className="text-sm text-muted-foreground">
                  {t('auth.wizard.babyLater')}
                </p>
              )}
              <Button
                onClick={() => {
                  void navigate({ to: '/' })
                }}
              >
                {t('auth.wizard.goHome')}
              </Button>
            </div>
          )}
        </div>
      </div>
    </AuthLayout>
  )
}
