import IconClose from '~icons/material-symbols/close-rounded'
import IconVideo from '~icons/material-symbols/videocam-outline-rounded'
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { AssetSummary } from '@/api/types'
import { cn } from '@/lib/utils'
import { thumbUrl } from '@/timeline/media'
import { Preview } from '@/upload/UploadConfirm'

// 서버 사진 또는 아직 올리지 않은 기기 파일. key 는 띠 안에서 고유.
export type StripItem =
  | { key: string; kind: 'asset'; asset: AssetSummary }
  | { key: string; kind: 'file'; file: File }

// 길게 누르기 판정 시간과 그 전 허용 이동(넘으면 가로 스크롤로 간주).
const LONG_PRESS_MS = 400
const MOVE_TOLERANCE = 8

function AssetThumb({ asset }: { asset: AssetSummary }) {
  return (
    <div
      className="relative size-full bg-muted"
      style={
        asset.dominant_color ? { backgroundColor: asset.dominant_color } : {}
      }
    >
      {asset.status === 'ready' && (
        <img
          src={thumbUrl(asset.id)}
          alt=""
          draggable={false}
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
        />
      )}
      {asset.kind === 'video' && (
        <IconVideo
          aria-hidden
          className="absolute bottom-1 left-1 size-4 text-white drop-shadow"
        />
      )}
    </div>
  )
}

// 고른 사진 가로 띠. ✕ 로 빼기, 길게 눌러 끌어 순서 바꾸기(키보드는 좌우 화살표).
// onReorder(key, to): key 항목을 빼서 to 자리에 넣기. 현재 자리는 호출 측 갱신 함수 안에서 key 로 찾음.
export function PhotoStrip({
  items,
  onRemove,
  onReorder,
}: {
  items: readonly StripItem[]
  onRemove: (key: string) => void
  onReorder: (key: string, to: number) => void
}) {
  const { t } = useTranslation()
  const list = useRef<HTMLUListElement>(null)
  const hintId = useId()
  const nodes = useRef(new Map<string, HTMLLIElement>())
  // 키보드로 옮긴 항목. 다시 그린 뒤 포커스 복원(keyed 이동 시 포커스 상실).
  const refocus = useRef<string | null>(null)
  const [announce, setAnnounce] = useState('')
  const press = useRef<{
    key: string
    x: number
    y: number
    timer: number
  } | null>(null)
  const [dragKey, setDragKey] = useState<string | null>(null)
  // 터치 스크롤 차단 판단용. 이벤트 리스너가 최신 상태를 읽도록 ref.
  const dragging = useRef(false)

  // 끌기 중 스크롤 차단. React 의 touchmove 는 passive 라 직접 등록.
  useEffect(() => {
    const el = list.current
    if (!el) return
    const block = (e: TouchEvent) => {
      if (dragging.current) e.preventDefault()
    }
    el.addEventListener('touchmove', block, { passive: false })
    return () => {
      el.removeEventListener('touchmove', block)
    }
  }, [])

  useLayoutEffect(() => {
    const key = refocus.current
    if (key === null) return
    refocus.current = null
    nodes.current.get(key)?.focus()
  })

  useEffect(
    () => () => {
      if (press.current) window.clearTimeout(press.current.timer)
    },
    [],
  )

  function endPress() {
    if (press.current) window.clearTimeout(press.current.timer)
    press.current = null
    dragging.current = false
    setDragKey(null)
  }

  function onPointerDown(e: PointerEvent<HTMLLIElement>, key: string) {
    if (e.button !== 0) return
    // ✕ 버튼은 끌기 대상 아님.
    if ((e.target as Element).closest('button')) return
    const el = e.currentTarget
    const pointerId = e.pointerId
    endPress()
    press.current = {
      key,
      x: e.clientX,
      y: e.clientY,
      timer: window.setTimeout(() => {
        dragging.current = true
        setDragKey(key)
        try {
          el.setPointerCapture(pointerId)
        } catch {
          // 이미 끝난 포인터. 다음 pointerup 에서 정리.
        }
      }, LONG_PRESS_MS),
    }
  }

  function onPointerMove(e: PointerEvent<HTMLLIElement>) {
    const p = press.current
    if (!p) return
    if (!dragging.current) {
      if (
        Math.abs(e.clientX - p.x) > MOVE_TOLERANCE ||
        Math.abs(e.clientY - p.y) > MOVE_TOLERANCE
      ) {
        endPress()
      }
      return
    }
    if (!list.current) return
    // 화면 순서 기준. 끄는 항목을 뺀 나머지 중 중심이 포인터 왼쪽인 개수 = 새 자리.
    const children = [...list.current.children]
    const from = children.findIndex(
      (c) => c instanceof HTMLElement && c.dataset.key === p.key,
    )
    if (from < 0) return
    const centers = children.flatMap((child, i) => {
      if (i === from) return []
      const r = child.getBoundingClientRect()
      return [r.left + r.width / 2]
    })
    const to = centers.filter((c) => c < e.clientX).length
    if (to !== from) onReorder(p.key, to)
  }

  function onKeyDown(
    e: KeyboardEvent<HTMLLIElement>,
    key: string,
    index: number,
  ) {
    if (e.target !== e.currentTarget) return
    const to =
      e.key === 'ArrowLeft'
        ? index - 1
        : e.key === 'ArrowRight'
          ? index + 1
          : null
    if (to === null || to < 0 || to >= items.length) return
    e.preventDefault()
    refocus.current = key
    onReorder(key, to)
    setAnnounce(t('stories.moved', { index: to + 1, count: items.length }))
  }

  return (
    <>
      <p id={hintId} className="sr-only">
        {t('stories.reorderHint')}
      </p>
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
      <ul
        ref={list}
        aria-label={t('stories.photos')}
        className="-mx-4 flex gap-2 overflow-x-auto px-4 py-1"
      >
        {items.map((item, i) => (
          <li
            key={item.key}
            ref={(el) => {
              if (el) nodes.current.set(item.key, el)
              else nodes.current.delete(item.key)
            }}
            data-key={item.key}
            tabIndex={0}
            aria-describedby={hintId}
            aria-label={t('stories.photoItem', {
              index: i + 1,
              count: items.length,
            })}
            className={cn(
              'relative size-24 shrink-0 rounded-xl outline-none select-none [-webkit-touch-callout:none] focus-visible:ring-2 focus-visible:ring-ring',
              dragKey === item.key &&
                'z-10 scale-105 shadow-lg ring-2 ring-primary',
            )}
            onPointerDown={(e) => {
              onPointerDown(e, item.key)
            }}
            onPointerMove={onPointerMove}
            onPointerUp={endPress}
            onPointerCancel={endPress}
            onContextMenu={(e) => {
              e.preventDefault()
            }}
            onKeyDown={(e) => {
              onKeyDown(e, item.key, i)
            }}
          >
            <div className="size-full overflow-hidden rounded-xl">
              {item.kind === 'asset' ? (
                <AssetThumb asset={item.asset} />
              ) : (
                <Preview file={item.file} />
              )}
            </div>
            <button
              type="button"
              aria-label={t('stories.removePhoto', { index: i + 1 })}
              onClick={() => {
                onRemove(item.key)
              }}
              className="absolute -top-1 -right-1 grid size-11 place-items-center"
            >
              <span className="grid size-6 place-items-center rounded-full bg-foreground/70 text-background">
                <IconClose aria-hidden className="size-4" />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}
