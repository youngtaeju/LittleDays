import type { TFunction } from 'i18next'
import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import IconComment from '~icons/material-symbols/chat-bubble-rounded'
import IconLike from '~icons/material-symbols/favorite-rounded'
import type { Baby, DaySummary, User } from '@/api/types'
import { formatAgeLine, formatSpecialDay, specialDay } from '@/lib/age'

// 이름 끝 글자 받침으로 이/가 고르기(i18n context). 한글이 아니면 판단 불가.
function josa(name: string): 'batchim' | 'unknown' | undefined {
  const code = name.charCodeAt(name.length - 1)
  if (code < 0xac00 || code > 0xd7a3) return 'unknown'
  return (code - 0xac00) % 28 ? 'batchim' : undefined
}

export function uploaderText(t: TFunction, names: string[]): string | null {
  const [first, second] = names
  if (!first) return null
  if (names.length >= 3) {
    return t('feed.uploadedByMany', { name: first, count: names.length - 1 })
  }
  if (!second) {
    return t('feed.uploadedBy', { name: first, context: josa(first) })
  }
  return t('feed.uploadedBy', {
    name: t('feed.pair', { a: first, b: second }),
    context: josa(second),
  })
}

export type AgePart = { text: string; special: boolean }

// 필터 아기, 아기가 1명이면 그 아기, 아니면 그날 태그된 아기 전부(아기 순서).
// 특별한 날은 나이 대신 배지.
export function ageParts(
  t: TFunction,
  day: Pick<DaySummary, 'date' | 'baby_ids'>,
  babies: Baby[],
  filter: string | undefined,
): AgePart[] {
  const targets = filter
    ? babies.filter((b) => b.id === filter)
    : babies.length === 1
      ? babies
      : babies.filter((b) => day.baby_ids.includes(b.id))
  // 여러 아기 중 누구 나이인지 이름 표시.
  const named = !filter && babies.length > 1
  return targets.flatMap((b) => {
    const special = specialDay(b.birth_date, day.date)
    const text = special
      ? formatSpecialDay(t, special)
      : formatAgeLine(t, b.birth_date, day.date)
    if (!text) return []
    return [{ text: named ? `${b.name} ${text}` : text, special: !!special }]
  })
}

// 멤버 목록 순서. 모르는 사용자(삭제 등)는 생략.
export function uploaderNames(
  users: User[] | undefined,
  ids: string[],
): string[] {
  return (users ?? [])
    .filter((u) => ids.includes(u.id))
    .map((u) => u.display_name)
}

// 나이 줄. 특별한 날은 배지. suffix 는 같은 줄 뒤에 이어 붙임. 둘 다 비면 그리지 않음.
export function AgeLine({
  parts,
  suffix,
  className = 'text-xs',
}: {
  parts: AgePart[]
  suffix?: string
  className?: string
}) {
  if (parts.length === 0 && !suffix) return null
  return (
    <p
      className={`${className} wrap-anywhere text-muted-foreground tabular-nums`}
    >
      {parts.map((a, i) => (
        <Fragment key={a.text}>
          {i > 0 && ' · '}
          {a.special ? (
            <span className="rounded-full bg-accent-soft px-2 py-0.5 font-semibold text-accent-ink">
              {a.text}
            </span>
          ) : (
            a.text
          )}
        </Fragment>
      ))}
      {suffix && `${parts.length > 0 ? ' · ' : ''}${suffix}`}
    </p>
  )
}

// 하루 하트와 댓글 합계(읽기 전용). 0 인 항목은 생략, 둘 다 0 이면 그리지 않음.
export function ReactionCounts({
  likes,
  comments,
  className = 'text-xs',
}: {
  likes: number
  comments: number
  className?: string
}) {
  const { t } = useTranslation()
  if (likes === 0 && comments === 0) return null
  const label = [
    likes > 0 ? t('feed.likeCount', { count: likes }) : null,
    comments > 0 ? t('feed.commentCount', { count: comments }) : null,
  ]
    .filter((v) => v != null)
    .join(', ')
  return (
    <span
      role="img"
      aria-label={label}
      className={`${className} flex shrink-0 items-center gap-2.5 font-semibold text-accent-ink tabular-nums`}
    >
      {likes > 0 && (
        <span aria-hidden className="flex items-center gap-0.5">
          <IconLike className="size-4" />
          {likes}
        </span>
      )}
      {comments > 0 && (
        <span aria-hidden className="flex items-center gap-0.5">
          <IconComment className="size-4" />
          {comments}
        </span>
      )}
    </span>
  )
}
