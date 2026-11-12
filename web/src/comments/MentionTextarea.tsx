import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { User } from '@/api/types'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { mentionQuery, type Picked } from './mentions'

const MENTION_LIMIT = 5

// 입력칸 글자와 고른 멘션. 본문 변환은 toBody.
export interface MentionValue {
  text: string
  picked: Picked[]
}

// 멘션 자동완성 입력칸. 댓글 입력, 이야기 쓰기 공용.
// 목록은 absolute. 위치(listClassName)의 기준은 호출 측의 relative 조상.
export function MentionTextarea({
  users,
  value,
  onChange,
  onSubmit,
  listClassName,
  ...props
}: {
  users: User[]
  value: MentionValue
  onChange: (value: MentionValue) => void
  // Ctrl(⌘)+Enter.
  onSubmit?: () => void
  listClassName?: string
} & Omit<
  ComponentProps<typeof Textarea>,
  'value' | 'onChange' | 'onSelect' | 'onKeyDown' | 'ref'
>) {
  const { t } = useTranslation()
  const { text, picked } = value
  const [caret, setCaret] = useState(text.length)
  const [active, setActive] = useState(0)
  // Esc 로 닫은 목록. 다음 입력에서 다시 판단.
  const [dismissed, setDismissed] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)
  // 멘션 삽입 뒤 커서 위치. 값이 화면에 반영된 다음 적용.
  const nextCaret = useRef<number | null>(null)
  const listId = useId()
  // 바깥에서 비운 값(댓글 올린 뒤 등). 이전 커서 위치 폐기.
  if (text === '' && caret !== 0) setCaret(0)

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
    setCaret(pos)
    nextCaret.current = pos
    onChange({
      text: next,
      picked: picked.some((x) => x.userId === u.id)
        ? picked
        : [...picked, { userId: u.id, name: u.display_name }],
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
    if (onSubmit && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      onSubmit()
    }
  }

  return (
    <>
      {listOpen && (
        <ul
          role="listbox"
          id={listId}
          aria-label={t('comments.mentionList')}
          className={cn(
            'absolute rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg',
            listClassName,
          )}
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
      <Textarea
        {...props}
        ref={box}
        value={text}
        aria-autocomplete="list"
        aria-controls={listOpen ? listId : undefined}
        aria-activedescendant={listOpen ? optionId(activeIndex) : undefined}
        // 시트의 Esc 닫기 예외 표시.
        data-mention-open={listOpen || undefined}
        onChange={(e) => {
          onChange({ text: e.target.value, picked })
          setCaret(e.target.selectionStart)
          setActive(0)
          setDismissed(false)
        }}
        onSelect={(e) => {
          setCaret(e.currentTarget.selectionStart)
        }}
        onKeyDown={onKeyDown}
      />
    </>
  )
}
