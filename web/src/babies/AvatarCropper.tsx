import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import { previewUrl, thumbUrl } from '@/timeline/media'
import { MAX_ZOOM, cropStyle, panCrop, zoomCrop, type AvatarCrop } from './crop'

// 원 지름. 휴대폰 320px 화면 시트 안에도 들어가는 크기.
export const CROP_VIEW_PX = 256
// 화살표 한 번 이동(px), +/- 한 번 배율.
const KEY_STEP_PX = 16
const KEY_ZOOM_STEP = 0.25

type Point = { x: number; y: number }

type Gesture =
  | { kind: 'pan'; id: number; start: Point; base: AvatarCrop }
  | { kind: 'pinch'; dist: number; base: AvatarCrop }

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

// 원 안 끌기 이동, 슬라이더·핀치 확대(1~4배), 화살표·+/- 키. 값은 회전 적용 후 원본 기준 비율.
export function AvatarCropper({
  assetId,
  width,
  height,
  crop,
  onChange,
}: {
  assetId: string
  width: number
  height: number
  crop: AvatarCrop
  onChange: (crop: AvatarCrop) => void
}) {
  const { t, i18n } = useTranslation()
  const hintId = useId()
  // preview 없으면(로드 실패) thumb.
  const [src, setSrc] = useState(() => previewUrl(assetId))
  const pointers = useRef(new Map<number, Point>())
  const gesture = useRef<Gesture | null>(null)
  const zoom = 1 / crop.size

  function startGesture() {
    const [a, b] = [...pointers.current.values()]
    if (a && b) {
      gesture.current = { kind: 'pinch', dist: distance(a, b), base: crop }
      return
    }
    const entry = [...pointers.current.entries()][0]
    gesture.current = entry
      ? { kind: 'pan', id: entry[0], start: entry[1], base: crop }
      : null
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (pointers.current.size >= 2) return
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // jsdom 등 미지원. 원 밖으로 나가면 끌기 중단될 뿐.
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    startGesture()
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return
    const p = { x: e.clientX, y: e.clientY }
    pointers.current.set(e.pointerId, p)
    const g = gesture.current
    if (!g) return
    if (g.kind === 'pinch') {
      const [a, b] = [...pointers.current.values()]
      if (!a || !b || g.dist === 0) return
      const next = ((1 / g.base.size) * distance(a, b)) / g.dist
      onChange(zoomCrop(g.base, next, width, height))
      return
    }
    if (g.id !== e.pointerId) return
    onChange(
      panCrop(
        g.base,
        p.x - g.start.x,
        p.y - g.start.y,
        width,
        height,
        CROP_VIEW_PX,
      ),
    )
  }

  // 손가락 하나 떼면 남은 손가락으로 이어서 끌기.
  function onPointerEnd(e: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.delete(e.pointerId)) return
    startGesture()
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const move: Record<string, Point> = {
      ArrowLeft: { x: -KEY_STEP_PX, y: 0 },
      ArrowRight: { x: KEY_STEP_PX, y: 0 },
      ArrowUp: { x: 0, y: -KEY_STEP_PX },
      ArrowDown: { x: 0, y: KEY_STEP_PX },
    }
    const d = move[e.key]
    if (d) {
      onChange(panCrop(crop, d.x, d.y, width, height, CROP_VIEW_PX))
    } else if (e.key === '+' || e.key === '=') {
      onChange(zoomCrop(crop, zoom + KEY_ZOOM_STEP, width, height))
    } else if (e.key === '-') {
      onChange(zoomCrop(crop, zoom - KEY_ZOOM_STEP, width, height))
    } else {
      return
    }
    e.preventDefault()
  }

  return (
    <div className="grid justify-items-center gap-3">
      <div
        role="group"
        tabIndex={0}
        aria-label={t('babies.cropArea')}
        aria-describedby={hintId}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onKeyDown={onKeyDown}
        className="relative cursor-grab touch-none overflow-hidden rounded-full bg-muted select-none active:cursor-grabbing"
        style={{ width: CROP_VIEW_PX, height: CROP_VIEW_PX }}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          decoding="async"
          onError={() => {
            setSrc(thumbUrl(assetId))
          }}
          style={cropStyle(crop, width, height, CROP_VIEW_PX)}
        />
      </div>
      <p id={hintId} className="text-center text-xs text-muted-foreground">
        {t('babies.cropHint')}
      </p>
      <input
        type="range"
        min={1}
        max={MAX_ZOOM}
        step={0.01}
        value={zoom}
        aria-label={t('babies.cropZoom')}
        aria-valuetext={t('babies.cropZoomValue', {
          zoom: zoom.toLocaleString(i18n.language, {
            maximumFractionDigits: 1,
          }),
        })}
        onChange={(e) => {
          onChange(zoomCrop(crop, Number(e.target.value), width, height))
        }}
        className="h-11 w-full max-w-64 accent-accent-ink"
      />
    </div>
  )
}
