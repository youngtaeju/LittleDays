import { Link, useRouterState } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { isNavActive, useNavItems, type NavItem } from './navItems'

function Tab({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = active ? item.activeIcon : item.icon
  return (
    <li className="min-w-0 flex-1">
      <Link
        to={item.to}
        // 선택은 isNavActive 기준. 라우터 자체 판정은 정확히 일치만(둘이 어긋나지 않게).
        activeOptions={{ exact: true, includeSearch: false }}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex h-14 w-full flex-col items-center justify-center gap-0.5 text-2xs text-muted-foreground',
          active && 'font-semibold text-accent-ink',
        )}
      >
        <Icon aria-hidden className="size-6" />
        {item.label}
      </Link>
    </li>
  )
}

// 1024px 미만 하단 탭. 추가하기는 탭 바 밖 떠 있는 버튼(AddFab).
export function TabBar() {
  const { t } = useTranslation()
  const items = useNavItems()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  return (
    <nav
      aria-label={t('nav.main')}
      data-testid="tab-bar"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
    >
      <ul className="flex items-center">
        {items.map((item) => (
          <Tab key={item.to} item={item} active={isNavActive(item, pathname)} />
        ))}
      </ul>
    </nav>
  )
}
