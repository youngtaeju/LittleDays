import type { Baby } from '@/api/types'
import { cn } from '@/lib/utils'

// 기록 시트 맨 위 아기 하나 고르기(아기 둘 이상일 때).
export function BabyRadioGroup({
  label,
  babies,
  selected,
  onSelect,
}: {
  label: string
  babies: Baby[]
  selected: string
  onSelect: (id: string) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex flex-wrap gap-x-2"
    >
      {babies.map((b) => {
        const on = b.id === selected
        return (
          // 터치 영역 44px, 보이는 칩은 그 안.
          <button
            key={b.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => {
              onSelect(b.id)
            }}
            className="flex h-11 max-w-48 items-center rounded-full"
          >
            <span
              className={cn(
                'truncate rounded-full px-3 py-1 text-sm',
                on
                  ? 'bg-primary font-semibold text-primary-foreground'
                  : 'bg-muted',
              )}
            >
              {b.name}
            </span>
          </button>
        )
      })}
    </div>
  )
}
