import { Link } from '@tanstack/react-router'
import { LoaderCircle, Play, TriangleAlert } from 'lucide-react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import type { AssetSummary } from '@/api/types'
import { Blurhash } from './Blurhash'
import { formatDay } from './group'
import { formatClock } from '@/viewer/zoned'
import { thumbUrl } from './media'

// m:ss. 1시간 이상도 분으로.
function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000)
  const s = total % 60
  return `${String(Math.floor(total / 60))}:${String(s).padStart(2, '0')}`
}

// 정사각 썸네일. 바탕은 dominant_color → blurhash → 썸네일 순으로 덮음.
// baby: 뷰어 이전/다음이 같은 필터 목록을 따르도록 전달.
// timezone: 인스턴스 시간대. 지정 시 라벨에 촬영 시각(HH:mm) 추가.
// onSelect: 지정 시 뷰어 링크 대신 버튼(휴지통 등). 안정된 콜백 필요(memo).
// memo: 목록 캐시 교체 시 바뀐 항목만 다시 그림(나머지 항목은 같은 객체).
export const Tile = memo(function Tile({
  item,
  baby,
  timezone,
  onSelect,
}: {
  item: AssetSummary
  baby?: string | undefined
  timezone?: string | undefined
  onSelect?: (id: string) => void
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
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover"
        />
      )}
      {item.status === 'processing' && (
        <span className="absolute top-1 right-1 rounded-full bg-black/50 p-1 text-white">
          <LoaderCircle
            role="img"
            aria-label={t('timeline.processing')}
            className="size-4 animate-spin motion-reduce:animate-none"
          />
        </span>
      )}
      {item.status === 'failed' && (
        <TriangleAlert
          role="img"
          aria-label={t('timeline.failed')}
          className="absolute inset-0 m-auto size-6 text-muted-foreground"
        />
      )}
      {video && (
        <span className="absolute right-0 bottom-0 flex items-center bg-black/50 px-1 text-xs text-white tabular-nums">
          {duration ?? <Play aria-hidden className="my-0.5 size-3.5" />}
        </span>
      )}
    </>
  )

  if (onSelect) {
    return (
      <button
        type="button"
        aria-label={label}
        onClick={() => {
          onSelect(item.id)
        }}
        className="relative block w-full aspect-square overflow-hidden bg-muted focus-visible:z-10 focus-visible:-outline-offset-2"
        style={style}
      >
        {content}
      </button>
    )
  }
  return (
    <Link
      to="/photo/$id"
      params={{ id: item.id }}
      search={{ baby }}
      aria-label={label}
      className="relative block aspect-square overflow-hidden bg-muted focus-visible:z-10 focus-visible:-outline-offset-2"
      style={style}
    >
      {content}
    </Link>
  )
})
