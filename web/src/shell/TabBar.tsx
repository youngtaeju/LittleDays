import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { hasRole, useMe } from '@/auth/session'
import { AddButton } from './AddButton'
import { useNavItems, type NavItem } from './navItems'

function Tab({ item }: { item: NavItem }) {
  return (
    <li className="min-w-0 flex-1">
      <Link
        to={item.to}
        // 홈은 아기 필터 search 와 무관하게 선택.
        activeOptions={{ exact: item.exact, includeSearch: false }}
        className="flex h-14 w-full flex-col items-center justify-center gap-0.5 text-2xs text-muted-foreground data-[status=active]:font-semibold data-[status=active]:text-accent-ink"
      >
        {({ isActive }) => {
          const Icon = isActive ? item.activeIcon : item.icon
          return (
            <>
              <Icon aria-hidden className="size-6" />
              {item.label}
            </>
          )
        }}
      </Link>
    </li>
  )
}

// 1024px 미만 하단 탭. family 는 (+) 없음. onAdd: 셸의 추가 시트 열기.
export function TabBar({ onAdd }: { onAdd: () => void }) {
  const { t } = useTranslation()
  const { user } = useMe()
  const items = useNavItems()
  return (
    <nav
      aria-label={t('nav.main')}
      data-testid="tab-bar"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
    >
      <ul className="flex items-center">
        {/* (+) 는 가운데(아기와 가족 사이). */}
        {items.slice(0, 2).map((item) => (
          <Tab key={item.to} item={item} />
        ))}
        {hasRole(user, 'guardian') && (
          <li className="flex flex-1 justify-center">
            <AddButton onClick={onAdd} />
          </li>
        )}
        {items.slice(2).map((item) => (
          <Tab key={item.to} item={item} />
        ))}
      </ul>
    </nav>
  )
}
