import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import {
  Baby,
  Ellipsis,
  Images,
  LogOut,
  Settings,
  Trash2,
  Upload,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { isLogoutError } from '@/api/errors'
import { hasRole, useLogout, useMe } from '@/auth/session'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { errorMessage } from '@/i18n'

interface NavItem {
  to: '/' | '/upload' | '/babies' | '/trash' | '/members' | '/settings'
  label: string
  icon: LucideIcon
}

// main = 하단 탭, more = 더보기 시트. 레일은 둘 다 펼침.
function useNavItems(): { main: NavItem[]; more: NavItem[] } {
  const { t } = useTranslation()
  const { user } = useMe()
  const guardian = hasRole(user, 'guardian')
  const main: NavItem[] = [
    { to: '/', label: t('nav.timeline'), icon: Images },
    ...(guardian
      ? [{ to: '/upload' as const, label: t('nav.upload'), icon: Upload }]
      : []),
    { to: '/babies', label: t('nav.babies'), icon: Baby },
  ]
  const more: NavItem[] = [
    ...(guardian
      ? [{ to: '/trash' as const, label: t('nav.trash'), icon: Trash2 }]
      : []),
    ...(hasRole(user, 'owner')
      ? [{ to: '/members' as const, label: t('nav.members'), icon: Users }]
      : []),
    { to: '/settings', label: t('nav.settings'), icon: Settings },
  ]
  return { main, more }
}

function useSignOut(): () => Promise<void> {
  const { t } = useTranslation()
  const logout = useLogout()
  const navigate = useNavigate()
  return async () => {
    try {
      await logout()
      await navigate({ to: '/login' })
    } catch (e) {
      // 세션 상실은 전역 처리에서 로그인 화면으로 이동.
      if (!isLogoutError(e)) toast.error(errorMessage(t, e))
    }
  }
}

// 타임라인은 아기 필터 search 와 무관하게 활성.
const linkActiveOptions = { exact: true, includeSearch: false }

const tabClass =
  'flex h-14 w-full flex-col items-center justify-center gap-0.5 text-xs text-muted-foreground data-[status=active]:font-semibold data-[status=active]:text-primary'

export function NavTabs() {
  const { t } = useTranslation()
  const { main, more } = useNavItems()
  const signOut = useSignOut()
  const [open, setOpen] = useState(false)
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const moreActive = more.some((i) => i.to === pathname)

  return (
    <nav
      aria-label={t('nav.main')}
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="flex">
        {main.map(({ to, label, icon: Icon }) => (
          <li key={to} className="min-w-0 flex-1">
            <Link
              to={to}
              activeOptions={linkActiveOptions}
              className={tabClass}
            >
              <Icon aria-hidden className="size-6" />
              {label}
            </Link>
          </li>
        ))}
        <li className="min-w-0 flex-1">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger
              className={tabClass}
              data-status={moreActive ? 'active' : undefined}
              aria-current={moreActive ? 'page' : undefined}
            >
              <Ellipsis aria-hidden className="size-6" />
              {t('nav.more')}
            </SheetTrigger>
            <SheetContent side="bottom" aria-describedby={undefined}>
              <SheetHeader>
                <SheetTitle>{t('nav.more')}</SheetTitle>
              </SheetHeader>
              <ul className="grid px-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
                {more.map(({ to, label, icon: Icon }) => (
                  <li key={to}>
                    <SheetClose asChild>
                      <Link to={to} className={sheetItemClass}>
                        <Icon aria-hidden className="size-5" />
                        {label}
                      </Link>
                    </SheetClose>
                  </li>
                ))}
                <li>
                  <button
                    type="button"
                    className={sheetItemClass}
                    onClick={() => {
                      setOpen(false)
                      void signOut()
                    }}
                  >
                    <LogOut aria-hidden className="size-5" />
                    {t('nav.logout')}
                  </button>
                </li>
              </ul>
            </SheetContent>
          </Sheet>
        </li>
      </ul>
    </nav>
  )
}

const sheetItemClass =
  'flex h-12 w-full items-center gap-3 rounded-md px-3 text-base data-[status=active]:font-semibold data-[status=active]:text-primary'

const railItemClass =
  'flex h-10 w-full items-center gap-3 rounded-md px-3 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground data-[status=active]:font-semibold data-[status=active]:text-primary'

// 1024px 이상. 하단 탭과 더보기 항목을 한 목록으로.
export function NavRail() {
  const { t } = useTranslation()
  const { main, more } = useNavItems()
  const signOut = useSignOut()
  return (
    <nav
      aria-label={t('nav.main')}
      className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col gap-1 border-r border-border px-3 py-4 lg:flex"
    >
      {[...main, ...more].map(({ to, label, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          activeOptions={linkActiveOptions}
          className={railItemClass}
        >
          <Icon aria-hidden className="size-5" />
          {label}
        </Link>
      ))}
      <button
        type="button"
        className={`mt-auto ${railItemClass}`}
        onClick={() => void signOut()}
      >
        <LogOut aria-hidden className="size-5" />
        {t('nav.logout')}
      </button>
    </nav>
  )
}
