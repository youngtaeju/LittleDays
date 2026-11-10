import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api, call } from '@/api/client'
import type { User } from '@/api/types'
import { setSignedIn } from '@/auth/session'
import { Field, FormError, formText } from '@/components/Field'
import { SelectField } from '@/components/NativeSelect'
import { Button } from '@/components/ui/button'
import { usersKey } from '@/members/useUsers'

export function ProfileSection({ user }: { user: User }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const save = useMutation({
    mutationFn: (body: {
      display_name?: string
      email?: string
      locale?: string
    }) => call(api.PATCH('/api/users/me', { body })),
    onSuccess: ({ user: updated }) => {
      // 캐시 갱신과 UI 언어 전환 동시 처리.
      setSignedIn(qc, updated)
      // 피드 올린 사람·가족 목록의 표시 이름.
      void qc.invalidateQueries({ queryKey: usersKey })
      toast(t('settings.profileSaved'))
    },
  })

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        const form = new FormData(e.currentTarget)
        const next = {
          display_name: formText(form, 'display_name').trim(),
          email: formText(form, 'email').trim(),
          locale: formText(form, 'locale'),
        }
        const body: Parameters<typeof save.mutate>[0] = {}
        if (next.display_name !== user.display_name) {
          body.display_name = next.display_name
        }
        if (next.email !== (user.email ?? '')) body.email = next.email
        if (next.locale !== user.locale) body.locale = next.locale
        if (Object.keys(body).length > 0) save.mutate(body)
      }}
    >
      <Field
        label={t('settings.displayName')}
        name="display_name"
        defaultValue={user.display_name}
        required
        maxLength={64}
      />
      <Field
        label={t('settings.email')}
        hint={t('settings.emailHint')}
        name="email"
        type="email"
        defaultValue={user.email ?? ''}
      />
      <SelectField
        label={t('settings.locale')}
        name="locale"
        defaultValue={user.locale}
      >
        <option value="ko">{t('settings.localeKo')}</option>
        <option value="en">{t('settings.localeEn')}</option>
      </SelectField>
      <FormError error={save.error} />
      <div>
        <Button type="submit" disabled={save.isPending}>
          {t('common.save')}
        </Button>
      </div>
    </form>
  )
}
