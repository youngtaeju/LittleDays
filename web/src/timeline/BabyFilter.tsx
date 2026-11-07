import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { Baby } from '@/api/types'
import { cn } from '@/lib/utils'

// 아기 2명 이상일 때만. 남아 있는 필터는 해제할 수 있게 표시.
export function BabyFilter({
  babies,
  selected,
}: {
  babies: Baby[]
  selected: string | undefined
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  if (babies.length < 2 && !selected) return null

  const chips = [
    { id: undefined, name: t('timeline.all') },
    ...babies.map((b) => ({ id: b.id, name: b.name })),
  ]
  return (
    <div
      role="group"
      aria-label={t('timeline.filter')}
      className="sticky top-14 z-10 -mx-4 -mt-4 mb-2 flex gap-2 overflow-x-auto bg-background px-4 py-2"
    >
      {chips.map(({ id, name }) => {
        const active = id === selected
        return (
          <button
            key={id ?? ''}
            type="button"
            aria-pressed={active}
            onClick={() => void navigate({ to: '/', search: { baby: id } })}
            className={cn(
              'h-8 shrink-0 rounded-full border border-border px-3 text-sm whitespace-nowrap',
              active &&
                'border-primary bg-primary font-semibold text-primary-foreground',
            )}
          >
            {name}
          </button>
        )
      })}
    </div>
  )
}
