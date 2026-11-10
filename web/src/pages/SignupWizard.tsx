import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
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
import IconArrowBack from '~icons/material-symbols/arrow-back-rounded'
import IconCheck from '~icons/material-symbols/check-rounded'
import IconClose from '~icons/material-symbols/close-rounded'
import { AuthLayout } from './AuthLayout'

const TOTAL_STEPS = 4
// 서버 규칙(server/src/auth/validate.rs)과 같은 값.
const PASSWORD_MIN = 8

type Step = 1 | 2 | 3 | 4
type FieldName = 'instance_name' | 'display_name' | 'username' | 'password'

// 서버 에러 키가 가리키는 입력칸. 없으면 폼 전체 오류.
function errorField(e: unknown): FieldName | null {
  if (!(e instanceof ApiError)) return null
  if (e.key === 'settings.instanceNameInvalid') return 'instance_name'
  if (e.key.startsWith('auth.username')) return 'username'
  if (e.key.startsWith('auth.password')) return 'password'
  if (e.key.startsWith('auth.displayName')) return 'display_name'
  return null
}

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

  const passwordMet = Array.from(values.password).length >= PASSWORD_MIN
  const canGoBack = step === 2

  return (
    <AuthLayout>
      <div className="grid gap-6">
        <div className="flex h-11 items-center justify-between">
          {canGoBack ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('auth.wizard.back')}
              onClick={() => {
                setStep((s) => (s - 1) as Step)
              }}
            >
              <IconArrowBack className="size-5" />
            </Button>
          ) : (
            <span className="size-11" />
          )}
          <div
            role="img"
            aria-label={t('auth.wizard.stepOf', {
              step,
              total: TOTAL_STEPS,
            })}
            className="flex gap-2"
          >
            {Array.from({ length: TOTAL_STEPS }, (_, i) => (
              <span
                key={i}
                className={`size-2 rounded-full ${i < step ? 'bg-primary' : 'bg-muted'}`}
              />
            ))}
          </div>
          <span className="size-11" />
        </div>

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
              <h1 className="text-xl font-bold">
                {t('auth.wizard.instanceTitle')}
              </h1>
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
                <h1 className="text-xl font-bold">
                  {t('auth.wizard.accountTitle')}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {t('auth.wizard.accountHint')}
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
              <ul className="grid gap-1 text-sm">
                <li
                  data-met={passwordMet}
                  className={`flex items-center gap-2 ${passwordMet ? 'text-foreground' : 'text-muted-foreground'}`}
                >
                  {passwordMet ? (
                    <IconCheck className="size-4 text-primary" aria-hidden />
                  ) : (
                    <IconClose className="size-4" aria-hidden />
                  )}
                  <span>{t('auth.wizard.passwordRuleLength')}</span>
                </li>
              </ul>
              <p role="status" className="sr-only">
                {passwordMet
                  ? t('auth.wizard.passwordRulesMet')
                  : t('auth.wizard.passwordRulesUnmet')}
              </p>
              {fieldError === null && <FormError error={signup.error} />}
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
              <h1 className="text-xl font-bold">
                {t('auth.wizard.babyTitle')}
              </h1>
              <Field
                label={t('auth.wizard.babyName')}
                hint={t('auth.wizard.babyNameHint')}
                maxLength={64}
                required
                autoFocus
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
              <h1 className="text-xl font-bold">
                {t('auth.wizard.doneTitle')}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t('auth.wizard.doneBody', { instance: values.instance_name })}
              </p>
              {babyFailed && (
                <p role="status" className="text-sm text-muted-foreground">
                  {t('auth.wizard.babyLater')}
                </p>
              )}
              <Button
                autoFocus
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
