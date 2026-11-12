import { Link } from '@tanstack/react-router'
import { useId, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { StorySummary, User } from '@/api/types'
import { toSegments } from '@/comments/mentions'
import { ReactionCounts } from '@/feed/dayMeta'
import { cn } from '@/lib/utils'
import { useUsers } from '@/members/useUsers'
import { thumbUrl } from '@/timeline/media'

// 본문. 멘션은 현재 표시 이름으로 강조.
export function MentionText({ body, users }: { body: string; users: User[] }) {
  const { t } = useTranslation()
  return toSegments(body, users, t('comments.unknownUser')).map((s, i) =>
    s.kind === 'text' ? (
      s.text
    ) : (
      <span key={i} className="font-semibold text-accent-ink">
        @{s.name}
      </span>
    ),
  )
}

// 상세 링크 이름에 넣을 본문 앞부분 글자 수.
const EXCERPT_CHARS = 20

// 본문 앞부분 한 줄. 멘션은 @이름, 공백 정리.
function excerpt(body: string, users: User[], unknown: string): string {
  const plain = toSegments(body, users, unknown)
    .map((s) => (s.kind === 'text' ? s.text : `@${s.name}`))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  const chars = Array.from(plain)
  return chars.length > EXCERPT_CHARS
    ? `${chars.slice(0, EXCERPT_CHARS).join('')}…`
    : plain
}

// 홈 하루 묶음, 그날 화면의 이야기. 왼쪽 강조선, 다른 날 사진 썸네일, 쓴 사람과 반응 수.
// compact: 3줄 넘으면 접고 "더 보기"/"접기"(제자리 펼침, 포커스 유지). 블록 전체가 상세 링크.
export function StoryBlock({
  story,
  compact = false,
}: {
  story: StorySummary
  compact?: boolean
}) {
  const { t } = useTranslation()
  const users = useUsers().data?.users ?? []
  const author =
    users.find((u) => u.id === story.author_id)?.display_name ??
    t('comments.unknownUser')
  const body = useRef<HTMLParagraphElement>(null)
  const bodyId = useId()
  const [overflow, setOverflow] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const clamped = compact && !expanded

  // 접힌 동안만 측정. 폭이 바뀌면 다시.
  useLayoutEffect(() => {
    const el = body.current
    if (!el || !clamped) return
    const measure = () => {
      setOverflow(el.scrollHeight > el.clientHeight + 1)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => {
      ro.disconnect()
    }
  }, [clamped, story.body])

  // 그날 사진은 모자이크, 그리드에 이미 있음. 다른 날 사진이 붙어 있을 때만 썸네일.
  const otherDay = story.previews.some((p) => p.local_date !== story.entry_date)

  return (
    // 그리드 항목. min-w-0 없으면 말줄임 이름의 전체 폭만큼 칸이 넓어짐.
    <div
      data-story
      className="relative min-w-0 border-l-[3px] border-primary py-0.5 pl-3"
    >
      <p
        ref={body}
        id={bodyId}
        className={cn(
          'text-sm leading-normal wrap-anywhere whitespace-pre-wrap',
          clamped && 'line-clamp-3',
        )}
      >
        <MentionText body={story.body} users={users} />
      </p>
      {compact && overflow && (
        // 상세 링크 위에 겹침.
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={bodyId}
          className="relative z-10 -my-2 min-h-11 text-xs font-semibold text-accent-ink"
          onClick={() => {
            setExpanded((v) => !v)
          }}
        >
          {expanded ? t('stories.less') : t('stories.more')}
        </button>
      )}
      {otherDay && (
        <div className="mt-2 flex items-center gap-1">
          {story.previews.slice(0, 4).map((a) => (
            <span
              key={a.id}
              className="relative size-12 shrink-0 overflow-hidden rounded-md bg-muted"
              style={
                a.dominant_color ? { backgroundColor: a.dominant_color } : {}
              }
            >
              {a.status === 'ready' && (
                <img
                  src={thumbUrl(a.id)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 size-full object-cover"
                />
              )}
            </span>
          ))}
          <span className="ml-1 text-2xs text-muted-foreground tabular-nums">
            {t('feed.photos', { count: story.asset_count })}
          </span>
        </div>
      )}
      <div className="mt-1 flex items-center justify-between gap-3 text-2xs text-muted-foreground">
        <span className="min-w-0 truncate">{author}</span>
        <ReactionCounts
          likes={story.like_count}
          comments={story.comment_count}
          className="text-2xs"
        />
      </div>
      <Link
        to="/stories/$id"
        params={{ id: story.id }}
        aria-label={t('stories.open', {
          name: author,
          excerpt: excerpt(story.body, users, t('comments.unknownUser')),
        })}
        className="absolute inset-0 rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      />
    </div>
  )
}
