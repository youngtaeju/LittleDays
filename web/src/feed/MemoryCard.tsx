import { Link } from '@tanstack/react-router'
import IconClose from '~icons/material-symbols/close-rounded'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatDate } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useToday } from '@/settings/useSettings'
import { previewUrl } from '@/timeline/media'
import { useMemory } from './useMemory'

const DISMISSED_KEY = 'ld:memory-dismissed'

// 숨긴 날짜(기기 저장). 저장소 접근 실패는 없는 것으로.
function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY)
  } catch {
    return null
  }
}

function writeDismissed(date: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY, date)
  } catch {
    // 저장 실패 시 화면 떠날 때까지만 숨김(상태).
  }
}

// 홈 맨 위 오늘의 추억. 사진 있는 날은 대표 사진 위 흰 글자, 글만 있는 날은 옅은 면과 이야기 첫 줄.
// 추억 없음, 조회 실패는 자리 없음. ✕ 는 오늘 하루 숨김.
export function MemoryCard({ baby }: { baby: string | undefined }) {
  const { t, i18n } = useTranslation()
  const today = useToday()
  const memory = useMemory(baby).data
  const [dismissed, setDismissed] = useState(readDismissed)
  if (!memory || dismissed === today) return null

  const { day } = memory
  const first = day.preview[0]
  // 처리 중, 실패 사진은 이미지 없이 옅은 면.
  const cover = first?.status === 'ready' ? first : undefined
  const title = t(`memory.${memory.kind}`, { count: memory.n })
  const meta = [
    formatDate(day.date, i18n.language),
    day.photo_count > 0 ? t('feed.photos', { count: day.photo_count }) : null,
    day.video_count > 0 ? t('feed.videos', { count: day.video_count }) : null,
  ]
    .filter((v) => v != null)
    .join(' · ')
  const story = day.stories[0]?.body.split('\n')[0]

  return (
    <section className="relative pt-2">
      <Link
        to="/days/$date"
        params={{ date: day.date }}
        search={{ baby }}
        className="relative block h-40 overflow-hidden rounded-2xl bg-accent-soft"
      >
        {cover ? (
          <>
            <img
              src={previewUrl(cover.id)}
              alt=""
              className="absolute inset-0 size-full object-cover"
            />
            <span
              aria-hidden
              className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent"
            />
          </>
        ) : null}
        <span
          className={
            cover
              ? 'absolute right-14 bottom-3 left-3 grid text-white [text-shadow:0_1px_4px_rgb(0_0_0/0.45)]'
              : 'absolute inset-y-3 right-0 left-3 grid content-between pr-11 text-accent-ink'
          }
        >
          {!cover && story && (
            <span className="line-clamp-3 text-sm wrap-anywhere text-foreground">
              {story}
            </span>
          )}
          <span className="grid">
            <span className="text-base font-bold">{title}</span>
            <span className="text-xs tabular-nums">{meta}</span>
          </span>
        </span>
      </Link>
      <button
        type="button"
        aria-label={t('memory.dismiss')}
        onClick={() => {
          setDismissed(today)
          writeDismissed(today)
        }}
        className={cn(
          'absolute top-2 right-0 flex size-11 items-center justify-center',
          cover
            ? 'text-white [filter:drop-shadow(0_1px_3px_rgb(0_0_0/0.5))]'
            : 'text-accent-ink',
        )}
      >
        <IconClose aria-hidden className="size-5" />
      </button>
    </section>
  )
}
