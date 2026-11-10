import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { Baby } from '@/api/types'
import { Avatar } from './Avatar'

// 아기 2명 이상일 때 맨 위 작은 아바타 줄. 선택 = aria-current(라우터) + 강조 테두리.
export function BabySwitcher({ babies }: { babies: Baby[] }) {
  const { t } = useTranslation()
  return (
    <nav
      aria-label={t('babies.switcher')}
      className="-mx-4 overflow-x-auto px-4"
    >
      <ul className="flex gap-2">
        {babies.map((b) => (
          <li key={b.id} className="shrink-0">
            <Link
              to="/babies/$id"
              params={{ id: b.id }}
              replace
              aria-label={b.name}
              className="group flex w-16 flex-col items-center gap-1 rounded-lg py-1 text-2xs text-muted-foreground data-[status=active]:font-semibold data-[status=active]:text-foreground"
            >
              <Avatar
                baby={b}
                size={40}
                className="ring-offset-2 ring-offset-background group-data-[status=active]:ring-2 group-data-[status=active]:ring-accent-ink"
              />
              <span className="w-full truncate text-center">{b.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
