import IconMore from '~icons/material-symbols/more-horiz-rounded'
import { DropdownMenu } from 'radix-ui'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { User } from '@/api/types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { toSegments } from './mentions'
import type { AnyComment } from './useComments'
import { relativeTime } from './relativeTime'

const LONG_PRESS_MS = 500
// 이보다 움직이면 스크롤로 보고 길게 누르기 취소.
const LONG_PRESS_SLOP_PX = 10

const MENU_ITEM =
  'flex min-h-11 cursor-default items-center gap-3 rounded-lg px-3 text-sm outline-none select-none data-[highlighted]:bg-accent'

function CommentItem({
  comment,
  users,
  now,
  canEdit,
  canDelete,
  onEdit,
  onDelete,
}: {
  comment: AnyComment
  users: User[]
  now: Date
  canEdit: boolean
  canDelete: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const { t, i18n } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)
  const press = useRef<{ timer: number; x: number; y: number } | null>(null)
  // 길게 누르기로 연 직후의 기본 메뉴(contextmenu) 차단용.
  const pressed = useRef(false)
  const hasMenu = canEdit || canDelete

  function cancelPress() {
    if (press.current) window.clearTimeout(press.current.timer)
    press.current = null
  }
  useEffect(() => cancelPress, [])

  const author = users.find((u) => u.id === comment.author_id)?.display_name
  const name = author ?? t('comments.unknownUser')
  // 고치기 선택 후 메뉴가 닫힐 때 ⋯ 로 포커스가 돌아가지 않게. 입력칸이 포커스 유지.
  const toComposer = useRef(false)

  return (
    <li
      className="flex gap-3 py-2"
      onPointerDown={(e) => {
        if (!hasMenu || e.pointerType !== 'touch') return
        pressed.current = false
        const { clientX: x, clientY: y } = e
        press.current = {
          x,
          y,
          timer: window.setTimeout(() => {
            press.current = null
            pressed.current = true
            setMenuOpen(true)
          }, LONG_PRESS_MS),
        }
      }}
      onPointerMove={(e) => {
        const p = press.current
        if (
          p &&
          Math.hypot(e.clientX - p.x, e.clientY - p.y) > LONG_PRESS_SLOP_PX
        )
          cancelPress()
      }}
      onPointerUp={cancelPress}
      onPointerCancel={cancelPress}
      onContextMenu={(e) => {
        if (pressed.current) e.preventDefault()
      }}
    >
      <span
        aria-hidden
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent-ink"
      >
        {Array.from(author ?? '')[0] ?? '?'}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-[13px] text-muted-foreground">
          <span className="font-semibold text-foreground">{name}</span>
          <time dateTime={comment.created_at} className="tabular-nums">
            {relativeTime(comment.created_at, now, i18n.language, t)}
          </time>
          {comment.edited_at && <span>{t('comments.edited')}</span>}
        </p>
        <p className="text-[15px] leading-normal break-words whitespace-pre-wrap">
          {toSegments(comment.body, users, t('comments.unknownUser')).map(
            (s, i) =>
              s.kind === 'text' ? (
                s.text
              ) : (
                <span key={i} className="font-semibold text-accent-ink">
                  @{s.name}
                </span>
              ),
          )}
        </p>
      </div>
      {hasMenu && (
        // 메뉴에서 대화상자를 여니 비모달.
        <DropdownMenu.Root
          modal={false}
          open={menuOpen}
          onOpenChange={setMenuOpen}
        >
          <DropdownMenu.Trigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="-mt-2 -mr-2 shrink-0"
              aria-label={t('comments.menu')}
            >
              <IconMore className="size-5" />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              className="dark z-50 min-w-40 rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg"
              onCloseAutoFocus={(e) => {
                if (!toComposer.current) return
                toComposer.current = false
                e.preventDefault()
              }}
            >
              {canEdit && (
                <DropdownMenu.Item
                  className={MENU_ITEM}
                  onSelect={() => {
                    toComposer.current = true
                    onEdit()
                  }}
                >
                  {t('comments.edit')}
                </DropdownMenu.Item>
              )}
              {canDelete && (
                <DropdownMenu.Item
                  className={cn(MENU_ITEM, 'text-destructive')}
                  onSelect={onDelete}
                >
                  {t('comments.delete')}
                </DropdownMenu.Item>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
    </li>
  )
}

// 내 댓글은 고치기와 지우기, owner/guardian 은 남의 댓글 지우기만.
export function CommentList({
  items,
  users,
  me,
  canDeleteOthers,
  onEdit,
  onDelete,
}: {
  items: AnyComment[]
  users: User[]
  me: string | undefined
  canDeleteOthers: boolean
  onEdit: (c: AnyComment) => void
  onDelete: (c: AnyComment) => void
}) {
  const now = new Date()
  return (
    <ul>
      {items.map((c) => {
        const mine = c.author_id === me
        return (
          <CommentItem
            key={c.id}
            comment={c}
            users={users}
            now={now}
            canEdit={mine}
            canDelete={mine || canDeleteOthers}
            onEdit={() => {
              onEdit(c)
            }}
            onDelete={() => {
              onDelete(c)
            }}
          />
        )
      })}
    </ul>
  )
}
