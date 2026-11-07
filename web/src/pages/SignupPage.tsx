import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, call } from '@/api/client'
import { setSignedIn } from '@/auth/session'
import { Field, FormError, formText } from '@/components/Field'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { pickLocale } from '@/i18n'
import { PlainLayout } from './PlainLayout'

// 1단계 계정·인스턴스 이름, 2단계 첫 아기(건너뛰기 가능).
export function SignupPage() {
  const [step, setStep] = useState<'account' | 'baby'>('account')
  return step === 'account' ? (
    <AccountStep
      onDone={() => {
        setStep('baby')
      }}
    />
  ) : (
    <BabyStep />
  )
}

function AccountStep({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const signup = useMutation({
    mutationFn: async (f: FormData) => {
      const { user } = await call(
        api.POST('/api/auth/signup', {
          body: {
            username: formText(f, 'username'),
            display_name: formText(f, 'display_name'),
            password: formText(f, 'password'),
            instance_name: formText(f, 'instance_name'),
          },
        }),
      )
      // 서버는 owner 언어를 ko 로 생성. 가입한 브라우저 언어로 1회 맞춤.
      const lng = pickLocale(null, navigator.language)
      if (lng === user.locale) return user
      return call(api.PATCH('/api/users/me', { body: { locale: lng } })).then(
        (r) => r.user,
        // 언어 맞춤 실패는 무시. 가입은 완료 상태.
        () => user,
      )
    },
    onSuccess: (user) => {
      setSignedIn(qc, user)
      onDone()
    },
  })

  return (
    <PlainLayout
      title={t('auth.signup.title')}
      description={t('auth.signup.description')}
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          signup.mutate(new FormData(e.currentTarget))
        }}
      >
        <Field
          label={t('auth.username')}
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          required
        />
        <Field
          label={t('auth.displayName')}
          name="display_name"
          autoComplete="nickname"
          required
        />
        <Field
          label={t('auth.password')}
          name="password"
          type="password"
          autoComplete="new-password"
          required
        />
        <Field
          label={t('auth.signup.instanceName')}
          hint={t('auth.signup.instanceNameHint')}
          name="instance_name"
          required
        />
        <FormError error={signup.error} />
        <Button type="submit" disabled={signup.isPending}>
          {t('auth.signup.submit')}
        </Button>
      </form>
    </PlainLayout>
  )
}

function BabyStep() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const sexId = useId()
  const goHome = () => navigate({ to: '/' })
  const addBaby = useMutation({
    mutationFn: (f: FormData) => {
      const sex = formText(f, 'sex')
      return call(
        api.POST('/api/babies', {
          body: {
            name: formText(f, 'name'),
            birth_date: formText(f, 'birth_date'),
            ...(sex === 'female' || sex === 'male' ? { sex } : {}),
          },
        }),
      )
    },
    onSuccess: goHome,
  })

  return (
    <PlainLayout
      title={t('auth.signup.babyTitle')}
      description={t('auth.signup.babyDescription')}
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          addBaby.mutate(new FormData(e.currentTarget))
        }}
      >
        {/* 단계 전환 후 포커스가 사라지지 않게 첫 입력란으로. */}
        <Field label={t('babies.name')} name="name" required autoFocus />
        <Field
          label={t('babies.birthDate')}
          name="birth_date"
          type="date"
          required
        />
        <div className="grid gap-2">
          <Label htmlFor={sexId}>{t('babies.sex')}</Label>
          <select
            id={sexId}
            name="sex"
            defaultValue=""
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-base md:text-sm"
          >
            <option value="">{t('babies.sexUnset')}</option>
            <option value="female">{t('babies.sexFemale')}</option>
            <option value="male">{t('babies.sexMale')}</option>
          </select>
        </div>
        <FormError error={addBaby.error} />
        <Button type="submit" disabled={addBaby.isPending}>
          {t('babies.add')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={addBaby.isPending}
          onClick={() => void goHome()}
        >
          {t('auth.signup.later')}
        </Button>
      </form>
    </PlainLayout>
  )
}
