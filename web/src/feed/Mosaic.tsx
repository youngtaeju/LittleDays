import { Link } from '@tanstack/react-router'
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { AssetSummary, DaySummary } from '@/api/types'
import { Blurhash } from '@/timeline/Blurhash'
import { thumbUrl } from '@/timeline/media'
import { Tile } from '@/timeline/Tile'
import { useProcessingPoll } from '@/timeline/useTimeline'

const MIN_ASPECT = 4 / 5
const MAX_ASPECT = 16 / 9

// 1장 칸 가로/세로 비율. 원본 비율을 세로 4:5 ~ 가로 16:9 로 제한, 크기 모르면 4:3.
export function singleAspect(
  width: number | null,
  height: number | null,
): number {
  if (!width || !height) return 4 / 3
  return Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, width / height))
}

// 처리 중 항목 폴링만 담당. 칸과 형제라 처리 완료 시 링크가 다시 마운트되지 않음(포커스 유지).
function ProcessingPoll({
  item,
  target,
}: {
  item: AssetSummary
  target: RefObject<HTMLElement | null>
}) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = target.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        const last = entries.at(-1)
        if (last) setVisible(last.isIntersecting)
      },
      { rootMargin: '200px 0px' },
    )
    io.observe(el)
    return () => {
      io.disconnect()
    }
  }, [target])
  useProcessingPoll(item, visible)
  return null
}

function Cell({
  item,
  className,
  style,
  children,
}: {
  item: AssetSummary
  className?: string
  style?: CSSProperties
  children: ReactNode
}) {
  const ref = useRef<HTMLLIElement>(null)
  return (
    <li ref={ref} className={className} style={style}>
      {children}
      {item.status === 'processing' && (
        <ProcessingPoll item={item} target={ref} />
      )}
    </li>
  )
}

// 4장 이상일 때 세 번째 칸. 사진 대신 그날 화면으로.
function MoreCell({
  item,
  date,
  label,
  total,
  baby,
}: {
  item: AssetSummary
  date: string
  label: string
  total: number
  baby: string | undefined
}) {
  const { t } = useTranslation()
  return (
    <Link
      to="/days/$date"
      params={{ date }}
      search={{ baby }}
      aria-label={t('feed.viewAll', { date: label, count: total })}
      className="relative block size-full overflow-hidden bg-muted focus-visible:z-10 focus-visible:-outline-offset-2"
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
      <span
        aria-hidden
        className="absolute inset-0 grid place-items-center bg-black/50 text-lg font-bold text-white tabular-nums"
      >
        +{total - 2}
      </span>
    </Link>
  )
}

// 피드 칸 폭(데스크톱 최대 640px) 기준 이미지 후보 크기.
const SIZES = {
  full: '(min-width: 640px) 640px, 100vw',
  half: '(min-width: 640px) 320px, 50vw',
  big: '(min-width: 640px) 427px, 67vw',
  small: '(min-width: 640px) 213px, 33vw',
}

// 대표 최신 3장. 1장 원본 비율, 2장 정사각 둘, 3장 이상 큰 1장(2/3) + 작은 2장.
// 화면 끝까지, 모서리 0, 간격 2px.
export function Mosaic({
  day,
  label,
  baby,
  timezone,
}: {
  day: DaySummary
  label: string
  baby: string | undefined
  timezone: string | undefined
}) {
  const items = day.preview
  const total = day.photo_count + day.video_count
  const [first, second, third] = items
  if (!first) return null

  const tile = (item: AssetSummary, sizes: string, fill = true) => (
    <Tile
      item={item}
      baby={baby}
      timezone={timezone}
      sizes={sizes}
      className={fill ? 'aspect-auto size-full' : undefined}
    />
  )

  if (!second) {
    return (
      <ul>
        <Cell
          item={first}
          style={{ aspectRatio: singleAspect(first.width, first.height) }}
        >
          {tile(first, SIZES.full)}
        </Cell>
      </ul>
    )
  }
  if (!third) {
    return (
      <ul className="grid grid-cols-2 gap-[2px]">
        {[first, second].map((item) => (
          <Cell key={item.id} item={item}>
            {tile(item, SIZES.half, false)}
          </Cell>
        ))}
      </ul>
    )
  }
  return (
    <ul className="grid aspect-[3/2] grid-cols-3 grid-rows-2 gap-[2px]">
      <Cell item={first} className="col-span-2 row-span-2">
        {tile(first, SIZES.big)}
      </Cell>
      <Cell item={second}>{tile(second, SIZES.small)}</Cell>
      <Cell item={third}>
        {total >= 4 ? (
          <MoreCell
            item={third}
            date={day.date}
            label={label}
            total={total}
            baby={baby}
          />
        ) : (
          tile(third, SIZES.small)
        )}
      </Cell>
    </ul>
  )
}
