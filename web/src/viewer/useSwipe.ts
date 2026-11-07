import { useRef, type PointerEvent } from 'react'

const MIN_DISTANCE = 60

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
      // 영상 컨트롤(탐색 막대) 드래그와 구분.
      if (e.target instanceof HTMLVideoElement) return
      start.current = { id: e.pointerId, x: e.clientX, y: e.clientY }
    },
    onPointerUp(e: PointerEvent) {
      const s = start.current
      if (!s || s.id !== e.pointerId) return
      start.current = null
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
