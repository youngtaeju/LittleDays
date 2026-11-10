import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { api, call } from '@/api/client'
import { setSignedIn } from '@/auth/session'
import { Field, FormError, formText } from '@/components/Field'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/i18n'
import { AuthLayout } from './AuthLayout'

export function InvitePage() {
  const { t } = useTranslation()
  const { raw } = useParams({ from: '/invite/$raw' })
  const navigate = useNavigate()
  const qc = useQueryClient()
  const preview = useQuery({
    queryKey: ['invite', raw],
    queryFn: () =>
      call(
        api.GET('/api/invites/{raw}/preview', { params: { path: { raw } } }),
      ),
  })
  const accept = useMutation({
    mutationFn: (f: FormData) =>
      call(
        api.POST('/api/invites/{raw}/accept', {
          params: { path: { raw } },
          body: {
            username: formText(f, 'username'),
            display_name: formText(f, 'display_name'),
            password: formText(f, 'password'),
          },
        }),
      ),
    onSuccess: async ({ user }) => {
      setSignedIn(qc, user)
      await navigate({ to: '/' })
    },
  })

  if (preview.isPending) return <AuthLayout title={t('common.loading')} />
  if (preview.isError) {
    // 만료·사용됨·회수됨(410), 없음(404) 모두 서버 키 문구.
    return (
      <AuthLayout title={errorMessage(t, preview.error)}>
        <Link
          to="/login"
          className="text-sm font-semibold text-accent-ink underline"
        >
          {t('auth.toLogin')}
        </Link>
      </AuthLayout>
    )
  }

  const { instance_name, role } = preview.data
  return (
    <AuthLayout
      title={t('auth.invite.title', { instance: instance_name })}
      description={
        <>
          <p>{t('auth.invite.role', { role: t(`roles.${role}`) })}</p>
          <p>{t('auth.invite.description')}</p>
        </>
      }
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          accept.mutate(new FormData(e.currentTarget))
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
        <FormError error={accept.error} />
        <Button type="submit" disabled={accept.isPending}>
          {t('auth.invite.submit')}
        </Button>
      </form>
    </AuthLayout>
  )
}
