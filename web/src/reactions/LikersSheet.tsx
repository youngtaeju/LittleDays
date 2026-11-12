import { useTranslation } from 'react-i18next'
import { FormError } from '@/components/Field'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useUsers } from '@/members/useUsers'
import { useLikes, type ReactionTarget } from './useReactions'

// 뷰어 위라 테마와 무관하게 어두운 시트. 데스크톱도 아래에서, 폭만 제한.
export function LikersSheet({
  target,
  open,
  onOpenChange,
}: {
  target: ReactionTarget
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const likes = useLikes(target, open)
  const users = useUsers().data?.users

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        aria-describedby={undefined}
        className="dark mx-auto max-h-[85dvh] w-full max-w-lg overflow-y-auto text-foreground"
      >
        <SheetHeader>
          <SheetTitle>{t('reactions.likersTitle')}</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {likes.data ? (
            <ul className="grid gap-1">
              {likes.data.map((like) => {
                const known = users?.find(
                  (u) => u.id === like.user_id,
                )?.display_name
                const name = known ?? t('comments.unknownUser')
                return (
                  <li
                    key={like.user_id}
                    className="flex min-h-12 items-center gap-3"
                  >
                    <span
                      aria-hidden
                      className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft font-bold text-accent-ink"
                    >
                      {Array.from(known ?? '')[0] ?? '?'}
                    </span>
                    <span className="truncate text-[15px]">{name}</span>
                  </li>
                )
              })}
            </ul>
          ) : likes.isError ? (
            <FormError error={likes.error} />
          ) : (
            <p className="text-sm text-muted-foreground">
              {t('common.loading')}
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
