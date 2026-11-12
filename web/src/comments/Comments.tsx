import IconLiked from '~icons/material-symbols/favorite-rounded'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { hasRole, useMe } from '@/auth/session'
import { FormError } from '@/components/Field'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { usePortalTheme } from '@/lib/portalTheme'
import { cn } from '@/lib/utils'
import { useUsers } from '@/members/useUsers'
import { likedByText } from '@/reactions/names'
import { useLikes, type ReactionTarget } from '@/reactions/useReactions'
import { CommentComposer } from './CommentComposer'
import { CommentList } from './CommentList'
import {
  isCommentGone,
  useComments,
  useDeleteComment,
  type AnyComment,
} from './useComments'

// 이만큼 끌면 시트 높이 전환.
const DRAG_PX = 30

// 목록과 입력칸. 휴대폰 시트, 데스크톱 패널 공용.
export function CommentThread({ target }: { target: ReactionTarget }) {
  const { t } = useTranslation()
  const { items, query } = useComments(target)
  const users = useUsers().data?.users ?? []
  const me = useMe().user
  const [editing, setEditing] = useState<AnyComment | null>(null)
  const [deleting, setDeleting] = useState<AnyComment | null>(null)
  const remove = useDeleteComment(target)
  const theme = usePortalTheme()
  // 이미 없는 댓글의 고치기/지우기 오류. 편집 모드, 대화상자를 닫은 뒤 입력칸 아래 표시.
  const [gone, setGone] = useState<unknown>(null)
  function onGone(e: unknown, id: string) {
    if (editing?.id === id) setEditing(null)
    setDeleting(null)
    setGone(e)
  }

  // 올린 뒤 목록 끝으로. 재조회와 남은 페이지까지 받은 다음.
  const scroller = useRef<HTMLDivElement>(null)
  const toEnd = useRef(false)
  const [posted, setPosted] = useState(0)
  const { hasNextPage } = query
  useEffect(() => {
    const el = scroller.current
    if (!toEnd.current || !el || hasNextPage) return
    el.scrollTop = el.scrollHeight
    toEnd.current = false
  }, [posted, items, hasNextPage])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4">
        {items ? (
          items.length > 0 ? (
            <CommentList
              items={items}
              users={users}
              me={me?.id}
              canDeleteOthers={hasRole(me, 'guardian')}
              onEdit={(c) => {
                setGone(null)
                setEditing(c)
              }}
              onDelete={(c) => {
                setGone(null)
                remove.reset()
                setDeleting(c)
              }}
            />
          ) : (
            <p className="py-8 text-center text-[15px] text-muted-foreground">
              {t('comments.empty')}
            </p>
          )
        ) : query.isError ? (
          <div className="py-4">
            <FormError error={query.error} />
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t('common.loading')}
          </p>
        )}
      </div>
      <CommentComposer
        key={editing?.id ?? 'new'}
        target={target}
        users={users}
        editing={editing}
        notice={gone}
        onEditDone={() => {
          setEditing(null)
        }}
        onGone={(e) => {
          if (editing) onGone(e, editing.id)
        }}
        onPosted={() => {
          setGone(null)
          toEnd.current = true
          setPosted((n) => n + 1)
        }}
      />
      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
      >
        <DialogContent className={cn(theme, 'text-foreground')}>
          <DialogHeader>
            <DialogTitle>{t('comments.deleteTitle')}</DialogTitle>
            <DialogDescription>
              {t('comments.deleteDescription')}
            </DialogDescription>
          </DialogHeader>
          <FormError error={remove.error} />
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{t('common.cancel')}</Button>
            </DialogClose>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => {
                if (!deleting) return
                const id = deleting.id
                remove.mutate(id, {
                  onSuccess: () => {
                    if (editing?.id === id) setEditing(null)
                    setDeleting(null)
                  },
                  onError: (e) => {
                    if (isCommentGone(e)) onGone(e, id)
                  },
                })
              }}
            >
              {t('comments.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// 휴대폰 댓글 시트. 처음 반쯤, 손잡이를 끌어 올리면 전체.
export function CommentSheet({
  target,
  open,
  onOpenChange,
  count,
  likeCount,
}: {
  target: ReactionTarget
  open: boolean
  onOpenChange: (open: boolean) => void
  count: number
  likeCount: number
}) {
  const { t } = useTranslation()
  const [full, setFull] = useState(false)
  const theme = usePortalTheme()
  const likes = useLikes(target, open && likeCount > 0)
  const users = useUsers().data?.users
  const dragStart = useRef<number | null>(null)
  // 끌기 뒤 따라오는 click 무시.
  const dragged = useRef(false)

  function change(next: boolean) {
    if (!next) setFull(false)
    onOpenChange(next)
  }

  const likers = likeCount > 0 ? likes.data : undefined
  const summary =
    likers && likers.length > 0
      ? likedByText(
          t,
          likers.map(
            (l) =>
              users?.find((u) => u.id === l.user_id)?.display_name ??
              t('comments.unknownUser'),
          ),
          likers.length,
        )
      : null

  return (
    <Sheet open={open} onOpenChange={change}>
      <SheetContent
        side="bottom"
        aria-describedby={undefined}
        onEscapeKeyDown={(e) => {
          // 멘션 목록이 열려 있으면 목록만 닫음(입력칸이 처리). 쓰던 글이 있으면 닫지 않음(실수로 유실 방지).
          const el = e.target instanceof Element ? e.target : null
          if (
            el?.closest('[data-mention-open]') ||
            (el instanceof HTMLTextAreaElement && el.value !== '')
          )
            e.preventDefault()
        }}
        className={cn(
          theme,
          'mx-auto flex w-full max-w-lg flex-col gap-0 text-foreground transition-[height] duration-200 ease-out motion-reduce:transition-none',
          full ? 'h-dvh rounded-none' : 'h-[55dvh]',
        )}
      >
        <div className="relative flex h-14 shrink-0 items-end gap-3 pr-14 pb-2 pl-4">
          {/* 머리 전체가 손잡이. 키보드는 눌러서 높이 전환. */}
          <button
            type="button"
            aria-label={full ? t('comments.collapse') : t('comments.expand')}
            className="absolute inset-0 touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onPointerDown={(e) => {
              // 머리 밖으로 끌어도 pointerup 수신.
              e.currentTarget.setPointerCapture(e.pointerId)
              dragStart.current = e.clientY
            }}
            onPointerUp={(e) => {
              const start = dragStart.current
              dragStart.current = null
              if (start === null) return
              const dy = e.clientY - start
              if (Math.abs(dy) < DRAG_PX) return
              dragged.current = true
              if (dy < 0) setFull(true)
              else if (full) setFull(false)
              else change(false)
            }}
            onPointerCancel={() => {
              dragStart.current = null
            }}
            onClick={() => {
              if (dragged.current) {
                dragged.current = false
                return
              }
              setFull((f) => !f)
            }}
          >
            <span className="absolute top-2 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full bg-muted-foreground/50" />
          </button>
          <SheetTitle className="pointer-events-none relative shrink-0 text-[17px] font-bold tabular-nums">
            {t('comments.title', { count })}
          </SheetTitle>
          {summary && (
            <p className="pointer-events-none relative ml-auto flex min-w-0 items-center gap-1 text-[13px] text-muted-foreground">
              <IconLiked aria-hidden className="size-4 shrink-0 text-primary" />
              <span className="truncate">{summary}</span>
            </p>
          )}
        </div>
        <CommentThread target={target} />
      </SheetContent>
    </Sheet>
  )
}
