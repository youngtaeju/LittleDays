import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { User } from '@/api/types'
import { FormError } from '@/components/Field'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useBrowserOnline } from '@/pwa/OfflineBanner'
import type { ReactionTarget } from '@/reactions/useReactions'
import { mentionQuery, toBody, toEditable, type Picked } from './mentions'
import {
  isCommentGone,
  useCreateComment,
  useUpdateComment,
  type AnyComment,
} from './useComments'

// 서버와 같은 기준. 앞뒤 공백 제거 후 유니코드 문자 수.
const MAX_CHARS = 1000
const MENTION_LIMIT = 5

// 아래 고정 입력칸. editing 이 있으면 그 댓글 고치기. 고치기 시작, 끝마다 key 로 새로 마운트.
export function CommentComposer({
  target,
  users,
  editing,
  notice,
  onEditDone,
  onGone,
  onPosted,
}: {
  target: ReactionTarget
  users: User[]
  editing: AnyComment | null
  // 입력칸 밖에서 난 오류(이미 없는 댓글). 이 입력칸의 오류가 우선.
  notice: unknown
  onEditDone: () => void
  onGone: (e: unknown) => void
  onPosted: () => void
}) {
  const { t } = useTranslation()
  const online = useBrowserOnline()
  const [initial] = useState(() =>
    editing
      ? toEditable(editing.body, users)
      : { text: '', picked: [] as Picked[] },
  )
  const [text, setText] = useState(initial.text)
  const [picked, setPicked] = useState(initial.picked)
  const [caret, setCaret] = useState(initial.text.length)
  const [active, setActive] = useState(0)
  // Esc 로 닫은 목록. 다음 입력에서 다시 판단.
  const [dismissed, setDismissed] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)
  // 멘션 삽입 뒤 커서 위치. 값이 화면에 반영된 다음 적용.
  const nextCaret = useRef<number | null>(null)
  const listId = useId()
  const create = useCreateComment(target)
  const update = useUpdateComment(target)
  const pending = create.isPending || update.isPending
  const error = editing ? update.error : create.error

  const body = toBody(text, picked).trim()
  const length = Array.from(body).length
  const over = length > MAX_CHARS

  const query = dismissed ? null : mentionQuery(text, caret)
  const candidates = query
    ? users
        .filter(
          (u) =>
            !u.disabled_at &&
            u.display_name.toLowerCase().startsWith(query.query.toLowerCase()),
        )
        .slice(0, MENTION_LIMIT)
    : []
  const listOpen = candidates.length > 0
  const activeIndex = Math.min(active, candidates.length - 1)
  const optionId = (i: number) => `${listId}-${String(i)}`

  useLayoutEffect(() => {
    const pos = nextCaret.current
    if (pos === null) return
    nextCaret.current = null
    box.current?.setSelectionRange(pos, pos)
  })

  function pick(u: User) {
    if (!query) return
    const insert = `@${u.display_name} `
    const next = text.slice(0, query.start) + insert + text.slice(caret)
    const pos = query.start + insert.length
    setText(next)
    setCaret(pos)
    nextCaret.current = pos
    setPicked((p) =>
      p.some((x) => x.userId === u.id)
        ? p
        : [...p, { userId: u.id, name: u.display_name }],
    )
  }

  function submit() {
    if (!body || over || pending || !online) return
    if (editing) {
      if (body === editing.body) {
        onEditDone()
        return
      }
      update.mutate(
        { id: editing.id, body },
        {
          onSuccess: onEditDone,
          onError: (e) => {
            if (isCommentGone(e)) onGone(e)
          },
        },
      )
      return
    }
    create.mutate(body, {
      onSuccess: () => {
        setText('')
        setPicked([])
        setCaret(0)
        onPosted()
      },
    })
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing) return
    if (listOpen) {
      const n = candidates.length
      if (e.key === 'ArrowDown') setActive((activeIndex + 1) % n)
      else if (e.key === 'ArrowUp') setActive((activeIndex - 1 + n) % n)
      else if (e.key === 'Enter' && !e.shiftKey) {
        const u = candidates[activeIndex]
        if (u) pick(u)
      } else if (e.key === 'Escape') {
        // 목록만 닫음. 시트, 뷰어 닫기로 이어지지 않게.
        e.stopPropagation()
        setDismissed(true)
      } else return
      e.preventDefault()
      return
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="relative shrink-0 border-t px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      {listOpen && (
        <ul
          role="listbox"
          id={listId}
          aria-label={t('comments.mentionList')}
          className="absolute inset-x-4 bottom-full mb-1 rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {candidates.map((u, i) => (
            <li
              key={u.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === activeIndex}
              className="flex min-h-11 cursor-default items-center rounded-lg px-3 text-[15px] aria-selected:bg-accent"
              // 입력칸 포커스 유지.
              onMouseDown={(e) => {
                e.preventDefault()
              }}
              onClick={() => {
                pick(u)
              }}
            >
              {u.display_name}
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <div className="flex items-center gap-1 text-[13px] text-muted-foreground">
          <span>{t('comments.editing')}</span>
          <Button
            variant="ghost"
            className="h-11 px-2 text-[13px]"
            onClick={onEditDone}
          >
            {t('common.cancel')}
          </Button>
        </div>
      )}
      {online ? (
        <div className="flex items-end gap-2">
          <Textarea
            ref={box}
            rows={1}
            value={text}
            autoFocus={editing !== null}
            aria-label={t('comments.input')}
            placeholder={t('comments.placeholder')}
            aria-autocomplete="list"
            aria-controls={listOpen ? listId : undefined}
            aria-activedescendant={listOpen ? optionId(activeIndex) : undefined}
            aria-invalid={over || undefined}
            // 시트의 Esc 닫기 예외 표시.
            data-mention-open={listOpen || undefined}
            className="max-h-[calc(4lh+1.25rem+2px)] min-h-11 resize-none overflow-y-auto py-2.5 text-[15px] leading-normal md:text-[15px]"
            onChange={(e) => {
              setText(e.target.value)
              setCaret(e.target.selectionStart)
              setActive(0)
              setDismissed(false)
            }}
            onSelect={(e) => {
              setCaret(e.currentTarget.selectionStart)
            }}
            onKeyDown={onKeyDown}
          />
          <Button
            className="h-11 shrink-0"
            disabled={!body || over || pending}
            onClick={submit}
          >
            {editing ? t('common.save') : t('comments.post')}
          </Button>
        </div>
      ) : (
        <p className="flex min-h-11 items-center justify-center text-[13px] text-muted-foreground">
          {t('comments.offline')}
        </p>
      )}
      {over && (
        <p className="pt-1 text-xs text-destructive tabular-nums">
          {t('comments.counter', { count: length })}
        </p>
      )}
      <FormError error={error ?? notice} />
    </div>
  )
}
