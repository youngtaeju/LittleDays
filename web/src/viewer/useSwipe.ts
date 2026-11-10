import { useRef, type PointerEvent } from 'react'

const MIN_DISTANCE = 60

// 뷰어 제스처 제외 대상. 버튼·링크·입력과 영상(기본 컨트롤 탐색 막대 조작과 구분).
export function ignoresGesture(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return !!target.closest('button, a, input, textarea, select, video')
}

// 가로 60px 이상이고 세로보다 큰 이동만. 다른 포인터 추가(핀치) 시 취소.
export function useSwipe({
  enabled,
  onLeft,
  onRight,
}: {
  enabled: boolean
  onLeft: () => void
  onRight: () => void
}) {
  const start = useRef<{ id: number; x: number; y: number } | null>(null)

  return {
    onPointerDown(e: PointerEvent) {
      if (!enabled) return
      // 같은 id 는 바깥에서 놓친 이전 포인터. 새로 시작.
      if (start.current && start.current.id !== e.pointerId) {
        start.current = null
        return
      }
      if (e.pointerType === 'mouse' && e.button !== 0) return
      if (ignoresGesture(e.target)) return
      start.current = { id: e.pointerId, x: e.clientX, y: e.clientY }
    },
    onPointerUp(e: PointerEvent) {
      const s = start.current
      if (!s || s.id !== e.pointerId) return
      start.current = null
      // 누른 사이 확대 시작 등으로 꺼졌으면 무시.
      if (!enabled) return
      const dx = e.clientX - s.x
      const dy = e.clientY - s.y
      if (Math.abs(dx) < MIN_DISTANCE || Math.abs(dx) <= Math.abs(dy)) return
      if (dx < 0) onLeft()
      else onRight()
    },
    onPointerCancel() {
      start.current = null
    },
  }
}
