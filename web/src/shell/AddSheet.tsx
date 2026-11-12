import { useNavigate } from '@tanstack/react-router'
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
import { useUploadPicker } from '@/upload/picker'

// (+) 시트. 사진/영상 올리기, 이야기 쓰기, 키/몸무게 기록, 마일스톤 기록.
// onGrowth, onMilestone 기본값은 아기 화면 이동(기록 시트 연결 전).
export function AddSheet({
  open,
  onOpenChange,
  onGrowth,
  onMilestone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onGrowth?: () => void
  onMilestone?: () => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const picker = useUploadPicker()
  const toBabies = () => {
    void navigate({ to: '/babies' })
  }
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
      // 선택창은 누른 그 이벤트 안에서 열어야 휴대폰 브라우저가 허용.
      run: picker.open,
    },
    {
      key: 'story',
      label: t('addSheet.story'),
      icon: IconStory,
      run: () => {
        void navigate({ to: '/stories/new' })
      },
    },
    {
      key: 'growth',
      label: t('addSheet.growth'),
      icon: IconGrowth,
      run: onGrowth ?? toBabies,
    },
    {
      key: 'milestone',
      label: t('addSheet.milestone'),
      icon: IconMilestone,
      run: onMilestone ?? toBabies,
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
