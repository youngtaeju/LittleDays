import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api, call } from '@/api/client'
import { ApiError } from '@/api/errors'
import { Field, FormError, formText } from '@/components/Field'
import { Button } from '@/components/ui/button'
import { sessionsKey } from './SessionsSection'

export function PasswordSection() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const change = useMutation({
    mutationFn: (body: { current_password: string; new_password: string }) =>
      call(api.POST('/api/users/me/password', { body })),
    onSuccess: () => {
      // 서버가 다른 세션을 모두 삭제하므로 목록 재조회.
      void qc.invalidateQueries({ queryKey: sessionsKey })
      toast(t('settings.passwordChanged'))
    },
  })

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        const form = e.currentTarget
        const data = new FormData(form)
        change.mutate(
          {
            current_password: formText(data, 'current_password'),
            new_password: formText(data, 'new_password'),
          },
          {
            onSuccess: () => {
              form.reset()
            },
          },
        )
      }}
    >
      <Field
        label={t('settings.currentPassword')}
        name="current_password"
        type="password"
        autoComplete="current-password"
        required
      />
      <Field
        label={t('settings.newPassword')}
        hint={t('settings.newPasswordHint')}
        name="new_password"
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
      />
      {change.error instanceof ApiError &&
      change.error.key === 'auth.invalidCredentials' ? (
        <p role="alert" className="text-sm text-destructive">
          {t('settings.currentPasswordWrong')}
        </p>
      ) : (
        <FormError error={change.error} />
      )}
      <div>
        <Button type="submit" disabled={change.isPending}>
          {t('settings.changePassword')}
        </Button>
      </div>
    </form>
  )
}
