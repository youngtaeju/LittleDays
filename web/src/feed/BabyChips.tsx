import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { Baby } from '@/api/types'
import { cn } from '@/lib/utils'

// 홈 아기 필터(?baby=). 선택 = 강조 채움, 나머지 = 옅은 면.
export function BabyChips({
  babies,
  selected,
}: {
  babies: Baby[]
  selected: string | undefined
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const chips = [
    { id: undefined, name: t('feed.all') },
    ...babies.map((b) => ({ id: b.id, name: b.name })),
  ]
  return (
    <div
      role="group"
      aria-label={t('feed.babyFilter')}
      className="-mx-4 flex gap-2 overflow-x-auto px-4"
    >
      {chips.map(({ id, name }) => {
        const active = id === selected
        return (
          // 터치 영역 44px, 보이는 칩은 그 안.
          <button
            key={id ?? ''}
            type="button"
            aria-pressed={active}
            onClick={() =>
              void navigate({ to: '/', search: { baby: id }, replace: true })
            }
            className="flex h-11 max-w-48 shrink-0 items-center rounded-full"
          >
            <span
              className={cn(
                'truncate rounded-full px-3 py-1 text-sm',
                active
                  ? 'bg-primary font-semibold text-primary-foreground'
                  : 'bg-muted',
              )}
            >
              {name}
            </span>
          </button>
        )
      })}
    </div>
  )
}
