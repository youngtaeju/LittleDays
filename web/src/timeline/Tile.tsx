import { Link } from '@tanstack/react-router'
import { LoaderCircle, Play, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AssetSummary } from '@/api/types'
import { Blurhash } from './Blurhash'
import { formatDay } from './group'
import { thumbUrl } from './media'

// m:ss. 1시간 이상도 분으로.
function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000)
  const s = total % 60
  return `${String(Math.floor(total / 60))}:${String(s).padStart(2, '0')}`
}

// 정사각 썸네일. 바탕은 dominant_color → blurhash → 썸네일 순으로 덮음.
export function Tile({ item }: { item: AssetSummary }) {
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
    state,
  ]
    .filter((v) => v != null)
    .join(', ')

  return (
    <Link
      to="/photo/$id"
      params={{ id: item.id }}
      aria-label={label}
      className="relative block aspect-square overflow-hidden bg-muted focus-visible:z-10 focus-visible:-outline-offset-2"
      style={
        item.dominant_color ? { backgroundColor: item.dominant_color } : {}
      }
    >
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
    </Link>
  )
}
