import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react'
import { ignoresGesture } from './useSwipe'

const MAX_SCALE = 4
const TAP_SCALE = 2.5
const DOUBLE_TAP_MS = 300
// 이 거리 안이면 누르기. 넘으면 끌기.
const TAP_SLOP = 10
const DOUBLE_TAP_DISTANCE = 40

type View = { scale: number; tx: number; ty: number }
type Point = { x: number; y: number }

const IDENTITY: View = { scale: 1, tx: 0, ty: 0 }

type Gesture =
  | { kind: 'pan'; id: number; start: Point; base: View; moved: boolean }
  | { kind: 'pinch'; dist: number; mid: Point; base: View }

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

// 화면에 맞춘(contain) 내용 크기 기준 이동 한계. 화면보다 작은 축은 가운데 고정.
function bound(v: View, rect: DOMRect, aspect: number | undefined): View {
  if (v.scale <= 1) return IDENTITY
  let w = rect.width
  let h = rect.height
  if (aspect && w > 0 && h > 0) {
    if (w / h > aspect) w = h * aspect
    else h = w / aspect
  }
  const mx = Math.max(0, (w * v.scale - rect.width) / 2)
  const my = Math.max(0, (h * v.scale - rect.height) / 2)
  return {
    scale: v.scale,
    tx: clamp(v.tx, -mx, mx),
    ty: clamp(v.ty, -my, my),
  }
}

// 점 p(화면 가운데 기준)를 고정한 채 배율 변경.
function zoomAt(v: View, scale: number, p: Point): View {
  const k = scale / v.scale
  return { scale, tx: p.x - (p.x - v.tx) * k, ty: p.y - (p.y - v.ty) * k }
}

// 포인터 이벤트 기반 확대. transform: translate(tx, ty) scale(scale), 기준점 가운데.
// enabled 가 꺼져도 누르기(onTap)는 감지(두 번 누르기 대기 없이 바로).
export function useZoom(
  ref: RefObject<HTMLElement | null>,
  {
    enabled = true,
    aspect,
    onTap,
  }: {
    enabled?: boolean
    aspect?: number | undefined
    onTap?: () => void
  } = {},
) {
  const [view, setView] = useState<View>(IDENTITY)
  const [gesturing, setGesturing] = useState(false)
  // reset 횟수. 바뀌면 대기 중인 한 번 누르기 취소(넘기기 직전 누르기가 다음 사진 막대를 바꾸지 않게).
  const [epoch, setEpoch] = useState(0)
  // 두 번 누르기 판별. reset 효과와 공유.
  const tap = useRef<{ last: { t: number; p: Point } | null; timer?: number }>({
    last: null,
  })

  // 이벤트 처리기용 최신 값.
  const viewRef = useRef(view)
  const opts = useRef({ enabled, aspect, onTap })
  useLayoutEffect(() => {
    viewRef.current = view
    opts.current = { enabled, aspect, onTap }
  })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const pointers = new Map<number, Point>()
    let gesture: Gesture | null = null
    const pending = tap.current

    // 화면 가운데 기준 좌표.
    function local(e: PointerEvent): Point {
      const r = el?.getBoundingClientRect()
      if (!r) return { x: 0, y: 0 }
      return {
        x: e.clientX - r.left - r.width / 2,
        y: e.clientY - r.top - r.height / 2,
      }
    }

    function apply(v: View) {
      const r = el?.getBoundingClientRect()
      if (!r) return
      const next = bound(v, r, opts.current.aspect)
      viewRef.current = next
      setView(next)
    }

    // moved: 핀치 뒤 남은 손가락처럼 누르기로 치지 않을 때 true.
    function startPan(id: number, p: Point, moved = false) {
      gesture = { kind: 'pan', id, start: p, base: viewRef.current, moved }
    }

    function startPinch() {
      const [a, b] = [...pointers.values()]
      if (!a || !b) return
      gesture = {
        kind: 'pinch',
        dist: distance(a, b),
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        base: viewRef.current,
      }
    }

    function handleTap(p: Point) {
      const { enabled: on, onTap: cb } = opts.current
      if (!on) {
        cb?.()
        return
      }
      const now = performance.now()
      if (
        pending.last &&
        now - pending.last.t <= DOUBLE_TAP_MS &&
        distance(pending.last.p, p) <= DOUBLE_TAP_DISTANCE
      ) {
        window.clearTimeout(pending.timer)
        pending.last = null
        const v = viewRef.current
        apply(v.scale > 1 ? IDENTITY : zoomAt(v, TAP_SCALE, p))
        return
      }
      pending.last = { t: now, p }
      window.clearTimeout(pending.timer)
      pending.timer = window.setTimeout(() => {
        pending.last = null
        opts.current.onTap?.()
      }, DOUBLE_TAP_MS)
    }

    function onDown(e: PointerEvent) {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      // 첫 손가락·마우스면 놓친 이전 포인터 정리.
      if (e.isPrimary) pointers.clear()
      if (pointers.size === 0 && ignoresGesture(e.target)) return
      if (pointers.size >= 2) return
      const p = local(e)
      pointers.set(e.pointerId, p)
      if (pointers.size === 1) {
        startPan(e.pointerId, p)
      } else if (opts.current.enabled) {
        // 두 손가락은 누르기 아님.
        window.clearTimeout(pending.timer)
        pending.last = null
        startPinch()
      } else {
        gesture = null
      }
    }

    function onMove(e: PointerEvent) {
      if (!pointers.has(e.pointerId)) return
      const p = local(e)
      pointers.set(e.pointerId, p)
      const g = gesture
      if (!g) return
      if (g.kind === 'pinch') {
        const [a, b] = [...pointers.values()]
        if (!a || !b || g.dist === 0) return
        const scale = clamp(
          (g.base.scale * distance(a, b)) / g.dist,
          1,
          MAX_SCALE,
        )
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        const z = zoomAt(g.base, scale, g.mid)
        setGesturing(true)
        apply({
          scale,
          tx: z.tx + mid.x - g.mid.x,
          ty: z.ty + mid.y - g.mid.y,
        })
        return
      }
      if (g.id !== e.pointerId) return
      const dx = p.x - g.start.x
      const dy = p.y - g.start.y
      if (!g.moved && Math.hypot(dx, dy) > TAP_SLOP) g.moved = true
      if (g.moved && g.base.scale > 1) {
        setGesturing(true)
        apply({ scale: g.base.scale, tx: g.base.tx + dx, ty: g.base.ty + dy })
      }
    }

    function onEnd(e: PointerEvent) {
      if (!pointers.has(e.pointerId)) return
      pointers.delete(e.pointerId)
      const g = gesture
      if (g?.kind === 'pinch') {
        // 남은 손가락은 현재 위치부터 이동.
        const [rest] = [...pointers.entries()]
        if (rest) {
          startPan(rest[0], rest[1], true)
        } else gesture = null
      } else {
        gesture = null
        if (g && e.type === 'pointerup' && !g.moved) handleTap(local(e))
      }
      if (pointers.size === 0) setGesturing(false)
    }

    el.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
    return () => {
      window.clearTimeout(pending.timer)
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
    }
  }, [ref])

  useEffect(() => {
    window.clearTimeout(tap.current.timer)
    tap.current.last = null
  }, [epoch])

  return {
    ...view,
    isZoomed: view.scale > 1,
    // 손가락 따라 움직이는 중. 전환 효과 끔.
    gesturing,
    reset: () => {
      setView(IDENTITY)
      setEpoch((n) => n + 1)
    },
    // 확대 단추·키보드용. 가운데 기준.
    toggle: () => {
      setView((v) =>
        v.scale > 1 ? IDENTITY : { scale: TAP_SCALE, tx: 0, ty: 0 },
      )
    },
  }
}
