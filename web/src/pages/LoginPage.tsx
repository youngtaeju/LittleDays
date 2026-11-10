import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { api, call } from '@/api/client'
import { authStatusQuery, setSignedIn } from '@/auth/session'
import { Field, FormError, formText } from '@/components/Field'
import { Button } from '@/components/ui/button'
import { ForgotPasswordSheet } from './ForgotPasswordSheet'
import { AuthLayout } from './AuthLayout'

export function LoginPage() {
  const { t } = useTranslation()
  const { redirect } = useSearch({ from: '/login' })
  const navigate = useNavigate()
  const qc = useQueryClient()
  const status = useQuery(authStatusQuery)
  const login = useMutation({
    mutationFn: (f: FormData) =>
      call(
        api.POST('/api/auth/login', {
          body: {
            username: formText(f, 'username'),
            password: formText(f, 'password'),
          },
        }),
      ),
    onSuccess: async ({ user }) => {
      setSignedIn(qc, user)
      await navigate({ href: redirect ?? '/' })
    },
  })

  return (
    <AuthLayout title={t('app.name')} description={t('auth.login.subtitle')}>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          login.mutate(new FormData(e.currentTarget))
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
          label={t('auth.password')}
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        <FormError error={login.error} />
        <Button type="submit" disabled={login.isPending}>
          {t('auth.login.submit')}
        </Button>
      </form>
      <ForgotPasswordSheet />
      {status.data?.signup_open && (
        <p className="text-sm text-muted-foreground">
          {t('auth.login.firstRun')}{' '}
          <Link
            to="/signup"
            className="font-semibold text-accent-ink underline"
          >
            {t('auth.login.toSignup')}
          </Link>
        </p>
      )}
    </AuthLayout>
  )
}
