import { Link } from '@tanstack/react-router'
import IconPlay from '~icons/material-symbols/play-arrow-rounded'
import IconProgress from '~icons/material-symbols/progress-activity-rounded'
import IconWarning from '~icons/material-symbols/warning-outline-rounded'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import type { AssetSummary } from '@/api/types'
import { Blurhash } from './Blurhash'
import { formatDay } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { formatClock } from '@/viewer/zoned'
import { previewSources, thumbUrl } from './media'

// m:ss. 1시간 이상도 분으로.
function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000)
  const s = total % 60
  return `${String(Math.floor(total / 60))}:${String(s).padStart(2, '0')}`
}

// 썸네일 + 미리보기 후보. 실제 가로 폭(w) 기준이라 칸 크기에 맞는 쪽을 브라우저가 고름.
function srcSet(item: AssetSummary): string | undefined {
  const { thumb, preview } = item.derivatives
  const webp = previewSources(item).webp
  if (!thumb || !preview || !webp) return undefined
  return `${thumbUrl(item.id)} ${String(thumb.width)}w, ${webp} ${String(preview.width)}w`
}

// 뷰어 이전/다음 기준 목록. 없으면 타임라인.
export type TileFrom = 'favorites' | 'story' | 'milestone' | 'videos'

// 기본 정사각 썸네일. 바탕은 dominant_color → blurhash → 썸네일 순으로 덮음.
// baby: 뷰어 이전/다음이 같은 필터 목록을 따르도록 전달.
// from, of: 이전/다음 기준 목록. 즐겨찾기, 영상, 또는 of 이야기/마일스톤의 사진 순서.
// timezone: 인스턴스 시간대. 지정 시 라벨에 촬영 시각(HH:mm) 추가.
// onSelect: 지정 시 뷰어 링크 대신 버튼(휴지통 등). 안정된 콜백 필요(memo). pressed: 여러 장 고르기의 선택 상태.
// sizes: 지정 시 미리보기까지 후보(큰 칸). className: 비율·크기 덮어쓰기.
// memo: 목록 캐시 교체 시 바뀐 항목만 다시 그림(나머지 항목은 같은 객체).
export const Tile = memo(function Tile({
  item,
  baby,
  from,
  of,
  timezone,
  onSelect,
  pressed,
  sizes,
  className,
  extraLabel,
}: {
  item: AssetSummary
  baby?: string | undefined
  from?: TileFrom
  of?: string
  timezone?: string | undefined
  onSelect?: (id: string) => void
  pressed?: boolean
  sizes?: string
  className?: string
  // 접근성 이름 끝에 덧붙일 문구(휴지통 남은 일수 등).
  extraLabel?: string | undefined
}) {
  const { t, i18n } = useTranslation()
  const video = item.kind === 'video'
  const duration =
    video && item.duration_ms != null ? formatDuration(item.duration_ms) : null
  const state =
    item.status === 'processing'
      ? t('timeline.processing')
      : item.status === 'failed'
        ? t('timeline.failed')
        : null
  const label = [
    video ? t('timeline.video') : t('timeline.photo'),
    duration,
    formatDay(item.local_date, i18n.language),
    timezone ? formatClock(item.taken_at, timezone, i18n.language) : null,
    state,
    extraLabel,
  ]
    .filter((v) => v != null)
    .join(', ')

  const style = item.dominant_color
    ? { backgroundColor: item.dominant_color }
    : {}
  const content = (
    <>
      {item.blurhash && (
        <Blurhash hash={item.blurhash} className="absolute inset-0 size-full" />
      )}
      {item.status === 'ready' && (
        <img
          src={thumbUrl(item.id)}
          srcSet={sizes ? srcSet(item) : undefined}
          sizes={sizes}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover"
        />
      )}
      {item.status === 'processing' && (
        <span className="absolute top-1 right-1 rounded-full bg-black/50 p-1 text-white">
          <IconProgress
            role="img"
            aria-label={t('timeline.processing')}
            className="size-4 animate-spin motion-reduce:animate-none"
          />
        </span>
      )}
      {item.status === 'failed' && (
        <IconWarning
          role="img"
          aria-label={t('timeline.failed')}
          className="absolute inset-0 m-auto size-6 text-muted-foreground"
        />
      )}
      {video && (
        <span className="absolute right-0 bottom-0 flex items-center bg-black/50 px-1 text-xs text-white tabular-nums">
          {duration ?? <IconPlay aria-hidden className="my-0.5 size-3.5" />}
        </span>
      )}
    </>
  )

  if (onSelect) {
    return (
      <button
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        onClick={() => {
          onSelect(item.id)
        }}
        className={cn(
          'relative block w-full aspect-square overflow-hidden bg-muted focus-visible:z-10 focus-visible:-outline-offset-2',
          className,
        )}
        style={style}
      >
        {content}
      </button>
    )
  }
  return (
    <Link
      to="/photos/$id"
      params={{ id: item.id }}
      search={{ baby, from, of }}
      aria-label={label}
      className={cn(
        'relative block aspect-square overflow-hidden bg-muted focus-visible:z-10 focus-visible:-outline-offset-2',
        className,
      )}
      style={style}
    >
      {content}
    </Link>
  )
})
