import { Link } from '@tanstack/react-router'
import { useId, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { hasRole, useMe } from '@/auth/session'
import { NativeSelect } from '@/components/NativeSelect'
import { Button, buttonVariants } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { useSignOut } from '@/auth/useSignOut'
import { useTheme, type ThemePref } from '@/theme/theme'
import { InstanceSection } from './InstanceSection'
import { PasswordSection } from './PasswordSection'
import { ProfileSection } from './ProfileSection'
import { SessionsSection } from './SessionsSection'
import { useSettings } from './useSettings'

const THEMES: ThemePref[] = ['system', 'light', 'dark']

function isThemePref(v: string): v is ThemePref {
  return THEMES.some((p) => p === v)
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="grid gap-3">
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  )
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

export function SettingsPage() {
  const { t } = useTranslation()
  const { user } = useMe()
  const settings = useSettings()
  const signOut = useSignOut()

  return (
    <div className="mx-auto grid max-w-xl gap-8">
      <h1 className="text-lg font-semibold">{t('settings.title')}</h1>
      {user && (
        <Section title={t('settings.profile')}>
          <ProfileSection user={user} />
        </Section>
      )}
      <Section title={t('settings.password')}>
        <PasswordSection />
      </Section>
      <Section title={t('settings.appearance')}>
        <ThemeField />
      </Section>
      <Section title={t('settings.sessions')}>
        <SessionsSection />
      </Section>
      {hasRole(user, 'owner') && settings && (
        <Section title={t('settings.instance')}>
          <InstanceSection settings={settings} />
        </Section>
      )}
      <div className="flex flex-wrap gap-2">
        {hasRole(user, 'guardian') && (
          <Link
            to="/me/trash"
            className={buttonVariants({ variant: 'outline' })}
          >
            {t('nav.trash')}
          </Link>
        )}
        <Button
          variant="outline"
          onClick={() => {
            void signOut()
          }}
        >
          {t('nav.logout')}
        </Button>
      </div>
    </div>
  )
}
