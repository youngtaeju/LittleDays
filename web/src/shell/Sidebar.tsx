import { Link, useRouterState } from '@tanstack/react-router'
import IconAdd from '~icons/material-symbols/add-rounded'
import IconStar from '~icons/material-symbols/star-outline-rounded'
import IconStarFill from '~icons/material-symbols/star-rounded'
import { useTranslation } from 'react-i18next'
import { hasRole, useMe } from '@/auth/session'
import { Button } from '@/components/ui/button'
import { useUploadPicker } from '@/upload/picker'
import { useNavItems } from './navItems'

function UploadButton() {
  const { t } = useTranslation()
  const { open } = useUploadPicker()
  return (
    <Button onClick={open} className="w-full">
      <IconAdd aria-hidden className="size-5" />
      {t('nav.add')}
    </Button>
  )
}

// 보조 메뉴(탭에 없는 목적지). 여기 있는 주소에서는 주 메뉴 "나" 선택 표시 안 함.
const MORE = [
  {
    to: '/me/favorites',
    label: 'nav.favorites',
    icon: IconStar,
    activeIcon: IconStarFill,
  },
] as const

const LINK =
  'flex h-11 w-full items-center gap-3 rounded-lg px-3 text-sm text-muted-foreground hover:bg-muted data-[status=active]:font-semibold data-[status=active]:text-accent-ink'

// 1024px 이상 왼쪽 220px. 우리 집 이름, 탭과 같은 메뉴, 보조 메뉴(탭에 없는 목적지), 맨 아래 사진 올리기.
export function Sidebar({ instanceName }: { instanceName?: string }) {
  const { t } = useTranslation()
  const { user } = useMe()
  const items = useNavItems()
  // 현재 항목 하나만 선택. 보조 메뉴 주소면 주 메뉴는 정확히 일치할 때만.
  const inMore = useRouterState({
    select: (s) =>
      MORE.some(
        ({ to }) =>
          s.location.pathname === to ||
          s.location.pathname.startsWith(`${to}/`),
      ),
  })
  return (
    <div className="sticky top-0 hidden h-dvh w-[220px] shrink-0 flex-col gap-4 border-r border-border px-3 py-4 lg:flex">
      <p className="truncate px-3 text-base font-bold">{instanceName}</p>
      <nav aria-label={t('nav.main')}>
        <ul className="grid gap-1">
          {items.map((item) => (
            <li key={item.to}>
              <Link
                to={item.to}
                activeOptions={{
                  exact: item.exact || inMore,
                  includeSearch: false,
                }}
                className={LINK}
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
          ))}
        </ul>
      </nav>
      <nav aria-label={t('nav.more')} className="border-t border-border pt-4">
        <ul className="grid gap-1">
          {MORE.map((item) => (
            <li key={item.to}>
              <Link to={item.to} className={LINK}>
                {({ isActive }) => {
                  const Icon = isActive ? item.activeIcon : item.icon
                  return (
                    <>
                      <Icon aria-hidden className="size-6" />
                      {t(item.label)}
                    </>
                  )
                }}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {hasRole(user, 'guardian') && (
        <div className="mt-auto">
          <UploadButton />
        </div>
      )}
    </div>
  )
}
