import { Link } from '@tanstack/react-router'
import IconAdd from '~icons/material-symbols/add-rounded'
import { useTranslation } from 'react-i18next'
import { hasRole, useMe } from '@/auth/session'
import { Button } from '@/components/ui/button'
import { useUploadPicker } from '@/upload/picker'
import { UploadCountBadge, useAddLabel } from './AddButton'
import { useNavItems } from './navItems'

function UploadButton() {
  const { t } = useTranslation()
  const { open } = useUploadPicker()
  const { label, count } = useAddLabel()
  return (
    <Button aria-label={label} onClick={open} className="w-full">
      <IconAdd aria-hidden className="size-5" />
      {t('nav.add')}
      <UploadCountBadge count={count} />
    </Button>
  )
}

// 1024px 이상 왼쪽 220px. 우리 집 이름, 탭과 같은 메뉴, 맨 아래 사진 올리기.
export function Sidebar({ instanceName }: { instanceName?: string }) {
  const { t } = useTranslation()
  const { user } = useMe()
  const items = useNavItems()
  return (
    <div className="sticky top-0 hidden h-dvh w-[220px] shrink-0 flex-col gap-4 border-r border-border px-3 py-4 lg:flex">
      <p className="truncate px-3 text-base font-bold">{instanceName}</p>
      <nav aria-label={t('nav.main')}>
        <ul className="grid gap-1">
          {items.map((item) => (
            <li key={item.to}>
              <Link
                to={item.to}
                activeOptions={{ exact: item.exact, includeSearch: false }}
                className="flex h-11 w-full items-center gap-3 rounded-lg px-3 text-sm text-muted-foreground hover:bg-muted data-[status=active]:font-semibold data-[status=active]:text-accent-ink"
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
      {hasRole(user, 'guardian') && (
        <div className="mt-auto">
          <UploadButton />
        </div>
      )}
    </div>
  )
}
