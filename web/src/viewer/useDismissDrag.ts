import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react'
import { ignoresGesture } from './useSwipe'

const DISMISS_DISTANCE = 120
// px/ms. 짧게 튕겨 내려도 닫기.
const DISMISS_VELOCITY = 0.5
// 방향 판단 전 움직임 허용치.
const SLOP = 10
// 속도 계산 구간.
const VELOCITY_WINDOW_MS = 100

type Sample = { y: number; t: number }
type Drag = {
  id: number
  x0: number
  y0: number
  axis: 'x' | 'y' | null
  samples: Sample[]
}

// 최근 구간 아래 방향 속도.
function velocity(samples: Sample[]): number {
  const last = samples[samples.length - 1]
  const first = samples.find((s) => last && last.t - s.t <= VELOCITY_WINDOW_MS)
  if (!first || !last || last.t <= first.t) return 0
  return (last.y - first.y) / (last.t - first.t)
}

// 아래로 끌어 닫기. 가로가 먼저 크면 넘기기로 보고 무시. 두 번째 손가락이 오면 취소.
export function useDismissDrag(
  ref: RefObject<HTMLElement | null>,
  { enabled, onDismiss }: { enabled: boolean; onDismiss: () => void },
) {
  const [state, setState] = useState({ offset: 0, dragging: false })
  const opts = useRef({ enabled, onDismiss })
  useLayoutEffect(() => {
    opts.current = { enabled, onDismiss }
  })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let drag: Drag | null = null
    // 같은 제스처의 추가 포인터. 하나라도 남으면 새 끌기 시작 안 함.
    const down = new Set<number>()

    function cancel() {
      drag = null
      setState({ offset: 0, dragging: false })
    }

    function onDown(e: PointerEvent) {
      // 첫 손가락·마우스면 놓친 이전 포인터 정리.
      if (e.isPrimary) down.clear()
      down.add(e.pointerId)
      if (down.size > 1) {
        if (drag) cancel()
        return
      }
      if (!opts.current.enabled) return
      // 터치·펜만. 데스크톱은 닫기 단추·Esc.
      if (e.pointerType === 'mouse') return
      if (ignoresGesture(e.target)) return
      drag = {
        id: e.pointerId,
        x0: e.clientX,
        y0: e.clientY,
        axis: null,
        samples: [{ y: e.clientY, t: performance.now() }],
      }
    }

    function onMove(e: PointerEvent) {
      const d = drag
      if (!d || d.id !== e.pointerId) return
      const dx = e.clientX - d.x0
      const dy = e.clientY - d.y0
      if (!d.axis) {
        if (Math.hypot(dx, dy) <= SLOP) return
        d.axis = Math.abs(dy) > Math.abs(dx) ? 'y' : 'x'
      }
      if (d.axis === 'x') {
        drag = null
        return
      }
      const t = performance.now()
      d.samples.push({ y: e.clientY, t })
      d.samples = d.samples.filter((s) => t - s.t <= VELOCITY_WINDOW_MS * 2)
      setState({ offset: Math.max(0, dy), dragging: true })
    }

    function onEnd(e: PointerEvent) {
      down.delete(e.pointerId)
      const d = drag
      if (!d || d.id !== e.pointerId) return
      drag = null
      if (d.axis !== 'y' || e.type !== 'pointerup') {
        cancel()
        return
      }
      d.samples.push({ y: e.clientY, t: performance.now() })
      const dy = e.clientY - d.y0
      if (dy >= DISMISS_DISTANCE || velocity(d.samples) > DISMISS_VELOCITY) {
        // 닫히는 동안 끈 위치 유지.
        setState({ offset: Math.max(0, dy), dragging: false })
        opts.current.onDismiss()
      } else {
        cancel()
      }
    }

    el.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
    }
  }, [ref])

  return state
}
