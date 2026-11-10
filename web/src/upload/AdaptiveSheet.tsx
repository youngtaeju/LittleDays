import type { ReactNode, RefObject } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { WIDE, useMediaQuery } from '@/lib/useMediaQuery'

// 업로드 확인·업로드 목록 공용. 휴대폰 아래 시트, 1024px 이상 가운데 대화상자.
export function AdaptiveSheet({
  title,
  onClose,
  showCloseButton = true,
  initialFocus,
  children,
}: {
  title: string
  onClose: () => void
  showCloseButton?: boolean
  // 처음 포커스. 비활성 등으로 못 받으면 기본(첫 포커스 가능 요소).
  initialFocus?: RefObject<HTMLElement | null>
  children: ReactNode
}) {
  const wide = useMediaQuery(WIDE)
  const onOpenChange = (open: boolean) => {
    if (!open) onClose()
  }
  const onOpenAutoFocus = (e: Event) => {
    const el = initialFocus?.current
    if (!el) return
    el.focus()
    if (document.activeElement === el) e.preventDefault()
  }
  if (wide) {
    return (
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent
          aria-describedby={undefined}
          showCloseButton={showCloseButton}
          onOpenAutoFocus={onOpenAutoFocus}
          className="max-h-[85dvh] overflow-y-auto"
        >
          <DialogHeader className="pr-10">
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          {children}
        </DialogContent>
      </Dialog>
    )
  }
  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        aria-describedby={undefined}
        showCloseButton={showCloseButton}
        onOpenAutoFocus={onOpenAutoFocus}
        className="max-h-[85dvh] gap-0 overflow-y-auto"
      >
        <SheetHeader className="pr-14">
          <SheetTitle className="text-base">{title}</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  )
}
