import { renderHook } from '@testing-library/react'
import type { PointerEvent } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useSwipe } from './useSwipe'

function event(id: number, x: number, y = 200): PointerEvent {
  return {
    pointerId: id,
    pointerType: 'touch',
    button: 0,
    clientX: x,
    clientY: y,
    target: document.body,
  } as unknown as PointerEvent
}

function setup(enabled = true) {
  const onLeft = vi.fn()
  const onRight = vi.fn()
  const { result } = renderHook(() => useSwipe({ enabled, onLeft, onRight }))
  return { swipe: result.current, onLeft, onRight }
}

describe('useSwipe', () => {
  it('swipe_left_and_right', () => {
    const { swipe, onLeft, onRight } = setup()
    swipe.onPointerDown(event(1, 300))
    swipe.onPointerUp(event(1, 200))
    expect(onLeft).toHaveBeenCalledTimes(1)
    swipe.onPointerDown(event(1, 100))
    swipe.onPointerUp(event(1, 200))
    expect(onRight).toHaveBeenCalledTimes(1)
  })

  it('pinch_cancels_swipe', () => {
    const { swipe, onLeft, onRight } = setup()
    swipe.onPointerDown(event(1, 300))
    swipe.onPointerDown(event(2, 320))
    // 두 번째 손가락을 먼저 떼고 첫 손가락으로 밀어도 넘기지 않음.
    swipe.onPointerUp(event(2, 320))
    swipe.onPointerUp(event(1, 100))
    expect(onLeft).not.toHaveBeenCalled()
    expect(onRight).not.toHaveBeenCalled()
  })

  it('pointercancel_resets', () => {
    const { swipe, onLeft } = setup()
    swipe.onPointerDown(event(1, 300))
    swipe.onPointerCancel()
    swipe.onPointerUp(event(1, 100))
    expect(onLeft).not.toHaveBeenCalled()
  })

  it('disabled_does_nothing', () => {
    const { swipe, onLeft } = setup(false)
    swipe.onPointerDown(event(1, 300))
    swipe.onPointerUp(event(1, 100))
    expect(onLeft).not.toHaveBeenCalled()
  })
})
