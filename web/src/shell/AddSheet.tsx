import IconPhoto from '~icons/material-symbols/add-photo-alternate-outline-rounded'
import IconMilestone from '~icons/material-symbols/celebration-outline-rounded'
import IconStory from '~icons/material-symbols/edit-note-rounded'
import IconGrowth from '~icons/material-symbols/straighten-outline-rounded'
import type { ComponentType, SVGProps } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

// 추가 시트. 사진/영상 올리기, 이야기 쓰기, 키/몸무게 기록, 마일스톤 기록.
// 항목 동작은 셸(AppShell)이 연결. 누르면 시트를 닫고 실행.
export function AddSheet({
  open,
  onOpenChange,
  onUpload,
  onStory,
  onGrowth,
  onMilestone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  // 선택창은 누른 그 이벤트 안에서 열어야 휴대폰 브라우저가 허용. 동기 호출.
  onUpload: () => void
  onStory: () => void
  // 없으면 항목 숨김(기록할 수 있는 아기 없음).
  onGrowth?: () => void
  onMilestone: () => void
}) {
  const { t } = useTranslation()
  const items: {
    key: string
    label: string
    icon: ComponentType<SVGProps<SVGSVGElement>>
    run: () => void
  }[] = [
    {
      key: 'upload',
      label: t('addSheet.upload'),
      icon: IconPhoto,
      run: onUpload,
    },
    {
      key: 'story',
      label: t('addSheet.story'),
      icon: IconStory,
      run: onStory,
    },
    ...(onGrowth
      ? [
          {
            key: 'growth',
            label: t('addSheet.growth'),
            icon: IconGrowth,
            run: onGrowth,
          },
        ]
      : []),
    {
      key: 'milestone',
      label: t('addSheet.milestone'),
      icon: IconMilestone,
      run: onMilestone,
    },
  ]

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        aria-describedby={undefined}
        className="mx-auto w-full max-w-lg gap-0"
      >
        <SheetHeader className="pr-14">
          <SheetTitle className="text-[17px] font-bold">
            {t('addSheet.title')}
          </SheetTitle>
        </SheetHeader>
        <ul className="grid gap-1 px-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {items.map(({ key, label, icon: Icon, run }) => (
            <li key={key}>
              <button
                type="button"
                className="flex min-h-14 w-full items-center gap-4 rounded-xl px-3 text-left text-[15px] font-semibold outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                  onOpenChange(false)
                  run()
                }}
              >
                <span
                  aria-hidden
                  className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-ink"
                >
                  <Icon className="size-6" />
                </span>
                {label}
              </button>
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  )
}
