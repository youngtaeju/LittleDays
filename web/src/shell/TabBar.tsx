import { Link, useRouterState } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { hasRole, useMe } from '@/auth/session'
import { cn } from '@/lib/utils'
import { AddButton } from './AddButton'
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

// 1024px 미만 하단 탭. family 는 (+) 대신 아기 탭(useNavItems). onAdd: 셸의 추가 시트 열기.
export function TabBar({ onAdd }: { onAdd: () => void }) {
  const { t } = useTranslation()
  const { user } = useMe()
  const items = useNavItems()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  return (
    <nav
      aria-label={t('nav.main')}
      data-testid="tab-bar"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
    >
      <ul className="flex items-center">
        {/* (+) 는 가운데(달력과 앨범 사이). */}
        {items.slice(0, 2).map((item) => (
          <Tab key={item.to} item={item} active={isNavActive(item, pathname)} />
        ))}
        {hasRole(user, 'guardian') && (
          <li className="flex flex-1 justify-center">
            <AddButton onClick={onAdd} />
          </li>
        )}
        {items.slice(2).map((item) => (
          <Tab key={item.to} item={item} active={isNavActive(item, pathname)} />
        ))}
      </ul>
    </nav>
  )
}
