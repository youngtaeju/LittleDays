import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { api, call } from '@/api/client'
import type { User } from '@/api/types'
import { setSignedIn } from '@/auth/session'
import { FormError } from '@/components/Field'
import { NativeSelect, SelectField } from '@/components/NativeSelect'
import { Label } from '@/components/ui/label'
import { useTheme, type ThemePref } from '@/theme/theme'

const THEMES: ThemePref[] = ['system', 'light', 'dark']

function isThemePref(v: string): v is ThemePref {
  return THEMES.some((p) => p === v)
}

function ThemeField() {
  const { t } = useTranslation()
  const [theme, setTheme] = useTheme()
  const id = useId()
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{t('settings.theme')}</Label>
      <NativeSelect
        id={id}
        value={theme}
        onChange={(e) => {
          if (isThemePref(e.target.value)) setTheme(e.target.value)
        }}
      >
        <option value="system">{t('settings.themeSystem')}</option>
        <option value="light">{t('settings.themeLight')}</option>
        <option value="dark">{t('settings.themeDark')}</option>
      </NativeSelect>
    </div>
  )
}

// 언어는 고르는 즉시 저장.
export function AppearanceSection({ user }: { user: User }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const save = useMutation({
    mutationFn: (locale: string) =>
      call(api.PATCH('/api/users/me', { body: { locale } })),
    // 캐시 갱신과 UI 언어 전환 동시 처리.
    onSuccess: ({ user: updated }) => {
      setSignedIn(qc, updated)
    },
  })
  return (
    <div className="grid gap-4">
      <ThemeField />
      <SelectField
        label={t('settings.language')}
        value={user.locale}
        disabled={save.isPending}
        onChange={(e) => {
          save.mutate(e.target.value)
        }}
      >
        <option value="ko">{t('settings.localeKo')}</option>
        <option value="en">{t('settings.localeEn')}</option>
      </SelectField>
      <FormError error={save.error} />
    </div>
  )
}
