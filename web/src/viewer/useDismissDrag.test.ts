import { fireEvent, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDismissDrag } from './useDismissDrag'

let now = 0

beforeEach(() => {
  now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

function setup(enabled = true) {
  const el = document.createElement('div')
  document.body.append(el)
  const ref = { current: el }
  const onDismiss = vi.fn()
  const hook = renderHook(
    (props: { enabled: boolean }) =>
      useDismissDrag(ref, { enabled: props.enabled, onDismiss }),
    { initialProps: { enabled } },
  )
  const at = (id: number, x: number, y: number) => ({
    pointerId: id,
    pointerType: 'touch',
    clientX: x,
    clientY: y,
  })
  return {
    hook,
    onDismiss,
    // 시각 지정 후 이벤트.
    down: (t: number, x: number, y: number, id = 1) => {
      now = t
      fireEvent.pointerDown(el, at(id, x, y))
    },
    move: (t: number, x: number, y: number, id = 1) => {
      now = t
      fireEvent.pointerMove(el, at(id, x, y))
    },
    up: (t: number, x: number, y: number, id = 1) => {
      now = t
      fireEvent.pointerUp(el, at(id, x, y))
    },
  }
}

describe('useDismissDrag', () => {
  it('drag_down_dismisses', () => {
    const { hook, onDismiss, down, move, up } = setup()
    down(0, 200, 100)
    move(500, 205, 160)
    expect(hook.result.current).toEqual({ offset: 60, dragging: true })
    move(1000, 210, 230)
    expect(hook.result.current.offset).toBe(130)
    up(1500, 210, 230)
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(hook.result.current.dragging).toBe(false)
  })

  it('fast_flick_dismisses', () => {
    const { onDismiss, down, move, up } = setup()
    down(0, 200, 100)
    move(10, 200, 120)
    move(40, 200, 160)
    up(50, 200, 165)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('small_drag_snaps_back', () => {
    const { hook, onDismiss, down, move, up } = setup()
    down(0, 200, 100)
    move(500, 200, 150)
    expect(hook.result.current.offset).toBe(50)
    up(1000, 200, 150)
    expect(onDismiss).not.toHaveBeenCalled()
    expect(hook.result.current).toEqual({ offset: 0, dragging: false })
  })

  it('upward_drag_does_not_move', () => {
    const { hook, onDismiss, down, move, up } = setup()
    down(0, 200, 400)
    move(10, 200, 200)
    expect(hook.result.current.offset).toBe(0)
    up(20, 200, 100)
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('horizontal_drag_ignored', () => {
    const { hook, onDismiss, down, move, up } = setup()
    down(0, 200, 100)
    move(10, 260, 120)
    // 가로로 정해진 뒤 세로 이동도 무시.
    move(20, 280, 400)
    expect(hook.result.current).toEqual({ offset: 0, dragging: false })
    up(30, 280, 400)
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('second_pointer_cancels', () => {
    const { hook, onDismiss, down, move, up } = setup()
    down(0, 200, 100)
    move(500, 200, 200)
    down(600, 300, 300, 2)
    expect(hook.result.current).toEqual({ offset: 0, dragging: false })
    up(700, 200, 300)
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('disabled_does_nothing', () => {
    const { hook, onDismiss, down, move, up } = setup(false)
    down(0, 200, 100)
    move(500, 200, 300)
    up(600, 200, 300)
    expect(hook.result.current.offset).toBe(0)
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('pinch_then_lift_does_not_drag', () => {
    const { hook, onDismiss, down, move, up } = setup()
    down(0, 200, 100)
    down(10, 300, 100, 2)
    up(20, 300, 100, 2)
    // 남은 손가락으로 끌어도 새 끌기 아님.
    move(500, 200, 400)
    expect(hook.result.current).toEqual({ offset: 0, dragging: false })
    up(600, 200, 400)
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('pointercancel_snaps_back', () => {
    const { hook, onDismiss, down, move } = setup()
    down(0, 200, 100)
    move(10, 200, 300)
    expect(hook.result.current).toEqual({ offset: 200, dragging: true })
    now = 20
    fireEvent.pointerCancel(document.body.firstElementChild ?? window, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 200,
      clientY: 300,
    })
    expect(hook.result.current).toEqual({ offset: 0, dragging: false })
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('mouse_drag_ignored', () => {
    const { hook, onDismiss } = setup()
    const el = document.body.firstElementChild
    if (!el) throw new Error('요소 없음')
    const mouse = (y: number) => ({
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      clientX: 200,
      clientY: y,
    })
    fireEvent.pointerDown(el, mouse(100))
    now = 500
    fireEvent.pointerMove(el, mouse(300))
    now = 1000
    fireEvent.pointerUp(el, mouse(300))
    expect(hook.result.current.offset).toBe(0)
    expect(onDismiss).not.toHaveBeenCalled()
  })
})
