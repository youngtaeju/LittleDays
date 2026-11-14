import { Link } from '@tanstack/react-router'
import IconChevron from '~icons/material-symbols/chevron-right-rounded'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { hasRole, useMe } from '@/auth/session'
import { useSignOut } from '@/auth/useSignOut'
import { cn } from '@/lib/utils'

type RowPath =
  | '/me/profile'
  | '/me/password'
  | '/me/devices'
  | '/me/appearance'
  | '/me/trash'
  | '/me/instance'
  | '/babies'
  | '/family'

const ROW =
  'flex min-h-14 w-full items-center gap-3 px-4 text-left text-[15px] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'

const CARD = 'rounded-xl bg-card'

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2">
      <h2 className="px-4 text-[13px] font-semibold text-muted-foreground">
        {title}
      </h2>
      <ul className={cn(CARD, 'divide-y divide-border/60 overflow-hidden')}>
        {children}
      </ul>
    </section>
  )
}

function NavRow({ to, label }: { to: RowPath; label: string }) {
  return (
    <li>
      <Link to={to} className={ROW}>
        <span className="flex-1">{label}</span>
        <IconChevron aria-hidden className="size-6 text-muted-foreground" />
      </Link>
    </li>
  )
}

export function MePage() {
  const { t } = useTranslation()
  const { user } = useMe()
  const signOut = useSignOut()
  const initial = Array.from(user?.display_name ?? '')[0] ?? '?'

  return (
    // 휴대폰: 셸 여백(px-4, pt-4, 아래 탭 바 여백)까지 옅은 바탕으로 채움. 데스크톱: 본문 칸 안의 패널.
    <div className="-mx-4 -mt-4 -mb-[calc(5rem+env(safe-area-inset-bottom))] grid min-h-[calc(100dvh-3.5rem)] grid-cols-[minmax(0,36rem)] content-start justify-center gap-7 bg-muted px-4 pt-4 pb-[calc(5rem+env(safe-area-inset-bottom))] lg:mx-auto lg:mt-0 lg:mb-0 lg:min-h-0 lg:max-w-xl lg:grid-cols-1 lg:rounded-2xl lg:pb-6">
      {user && (
        <Link to="/me/profile" className={cn(ROW, CARD, 'min-h-20 gap-4')}>
          <span
            aria-hidden
            className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xl font-bold text-accent-ink"
          >
            {initial}
          </span>
          <span className="grid min-w-0 flex-1 gap-0.5">
            <h1 className="truncate text-xl font-bold">{user.display_name}</h1>
            <span className="truncate text-[13px] text-muted-foreground">
              @{user.username}
            </span>
          </span>
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">
            {t(`roles.${user.role}`)}
          </span>
          <IconChevron aria-hidden className="size-6 text-muted-foreground" />
        </Link>
      )}
      {hasRole(user, 'guardian') && (
        <Group title={t('me.photos')}>
          <NavRow to="/me/trash" label={t('me.trash')} />
        </Group>
      )}
      <Group title={t('me.home')}>
        <NavRow to="/babies" label={t('me.babies')} />
        <NavRow to="/family" label={t('me.family')} />
        {hasRole(user, 'owner') && (
          <NavRow to="/me/instance" label={t('me.instance')} />
        )}
      </Group>
      <Group title={t('me.account')}>
        <NavRow to="/me/profile" label={t('me.profile')} />
        <NavRow to="/me/password" label={t('me.password')} />
        <NavRow to="/me/devices" label={t('me.devices')} />
      </Group>
      <Group title={t('me.app')}>
        <NavRow to="/me/appearance" label={t('me.appearance')} />
      </Group>
      <div className="grid gap-3">
        <button
          type="button"
          className={cn(ROW, CARD, 'text-destructive')}
          onClick={() => {
            void signOut()
          }}
        >
          {t('me.logout')}
        </button>
        <p className="text-center text-xs text-muted-foreground tabular-nums">
          {t('me.version', { version: __APP_VERSION__ })}
        </p>
      </div>
    </div>
  )
}
