import { act, fireEvent, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useZoom } from './useZoom'

let now = 0

beforeEach(() => {
  now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

// 400×800 화면, 같은 비율 사진(화면에 꽉 참).
function setup(enabled = true) {
  const el = document.createElement('div')
  document.body.append(el)
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: 400,
    bottom: 800,
    width: 400,
    height: 800,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
  const ref = { current: el }
  const onTap = vi.fn()
  const hook = renderHook(
    (props: { enabled: boolean }) =>
      useZoom(ref, { enabled: props.enabled, aspect: 0.5, onTap }),
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
    onTap,
    down: (id: number, x: number, y: number) =>
      fireEvent.pointerDown(el, at(id, x, y)),
    move: (id: number, x: number, y: number) =>
      fireEvent.pointerMove(el, at(id, x, y)),
    up: (id: number, x: number, y: number) =>
      fireEvent.pointerUp(el, at(id, x, y)),
    cancel: (id: number, x: number, y: number) =>
      fireEvent.pointerCancel(el, at(id, x, y)),
  }
}

describe('useZoom', () => {
  it('pinch_scales_and_clamps', () => {
    const { hook, down, move, up } = setup()
    down(1, 150, 400)
    down(2, 250, 400)
    move(2, 450, 400)
    expect(hook.result.current.scale).toBeCloseTo(3)
    expect(hook.result.current.isZoomed).toBe(true)

    // 4배 초과 고정.
    move(2, 650, 400)
    expect(hook.result.current.scale).toBe(4)

    // 1배 미만 고정, 이동 초기화.
    move(2, 160, 400)
    expect(hook.result.current).toMatchObject({ scale: 1, tx: 0, ty: 0 })
    expect(hook.result.current.isZoomed).toBe(false)
    up(2, 160, 400)
    up(1, 150, 400)
  })

  it('pinch_ignored_when_disabled', () => {
    const { hook, down, move } = setup(false)
    down(1, 150, 400)
    down(2, 250, 400)
    move(2, 450, 400)
    expect(hook.result.current.scale).toBe(1)
  })

  it('double_tap_toggles', () => {
    const { hook, onTap, down, up } = setup()
    // 가운데에서 100px 오른쪽 지점 고정한 채 2.5배.
    down(1, 300, 400)
    up(1, 300, 400)
    now = 200
    down(1, 302, 401)
    up(1, 302, 401)
    expect(hook.result.current.scale).toBe(2.5)
    expect(hook.result.current.tx).toBeCloseTo(-153)
    expect(hook.result.current.ty).toBeCloseTo(-1.5)

    now = 1000
    down(1, 200, 400)
    up(1, 200, 400)
    now = 1100
    down(1, 200, 400)
    up(1, 200, 400)
    expect(hook.result.current).toMatchObject({ scale: 1, tx: 0, ty: 0 })

    // 두 번 누르기는 한 번 누르기 아님.
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(onTap).not.toHaveBeenCalled()
  })

  it('single_tap_after_delay', () => {
    const { onTap, down, up } = setup()
    down(1, 200, 400)
    up(1, 200, 400)
    act(() => {
      vi.advanceTimersByTime(299)
    })
    expect(onTap).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(onTap).toHaveBeenCalledTimes(1)

    // 300ms 넘긴 두 번째 누르기는 다시 한 번 누르기.
    now = 400
    down(1, 200, 400)
    up(1, 200, 400)
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(onTap).toHaveBeenCalledTimes(2)
  })

  it('tap_immediate_when_disabled', () => {
    const { onTap, down, up } = setup(false)
    down(1, 200, 400)
    up(1, 200, 400)
    expect(onTap).toHaveBeenCalledTimes(1)
  })

  it('drag_is_not_tap', () => {
    const { onTap, down, move, up } = setup()
    down(1, 200, 400)
    move(1, 200, 450)
    up(1, 200, 450)
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(onTap).not.toHaveBeenCalled()
  })

  it('pan_bounded', () => {
    const { hook, down, move, up } = setup()
    // 1배에선 끌어도 이동 없음.
    down(1, 200, 400)
    move(1, 300, 500)
    up(1, 300, 500)
    expect(hook.result.current).toMatchObject({ scale: 1, tx: 0, ty: 0 })

    now = 1000
    down(1, 200, 400)
    up(1, 200, 400)
    now = 1100
    down(1, 200, 400)
    up(1, 200, 400)
    expect(hook.result.current.scale).toBe(2.5)

    // 2.5배: 가로 ±300, 세로 ±600 까지.
    now = 2000
    down(1, 200, 400)
    move(1, 300, 450)
    expect(hook.result.current).toMatchObject({ tx: 100, ty: 50 })
    move(1, 1200, 400)
    expect(hook.result.current).toMatchObject({ tx: 300, ty: 0 })
    move(1, -800, 1800)
    expect(hook.result.current).toMatchObject({ tx: -300, ty: 600 })
    up(1, -800, 1800)
    expect(hook.result.current.scale).toBe(2.5)
  })

  it('pan_bounded_by_fitted_size', () => {
    // 가로 사진(4:3)은 400×300 으로 맞춤. 2배에서 세로 이동 여지 없음.
    const el = document.createElement('div')
    document.body.append(el)
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 400,
      bottom: 800,
      width: 400,
      height: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    const ref = { current: el }
    const { result } = renderHook(() =>
      useZoom(ref, { enabled: true, aspect: 4 / 3 }),
    )
    const at = (x: number, y: number) => ({
      pointerId: 1,
      pointerType: 'touch',
      clientX: x,
      clientY: y,
    })
    fireEvent.pointerDown(el, at(200, 400))
    fireEvent.pointerUp(el, at(200, 400))
    now = 100
    fireEvent.pointerDown(el, at(200, 400))
    fireEvent.pointerUp(el, at(200, 400))
    expect(result.current.scale).toBe(2.5)

    now = 1000
    fireEvent.pointerDown(el, at(200, 400))
    fireEvent.pointerMove(el, at(600, 800))
    // 가로 (400×2.5−400)/2 = 300, 세로 300×2.5 = 750 < 800 → 0.
    expect(result.current).toMatchObject({ tx: 300, ty: 0 })
  })

  it('reset_and_toggle', () => {
    const { hook } = setup()
    act(() => {
      hook.result.current.toggle()
    })
    expect(hook.result.current).toMatchObject({ scale: 2.5, tx: 0, ty: 0 })
    act(() => {
      hook.result.current.reset()
    })
    expect(hook.result.current).toMatchObject({ scale: 1, tx: 0, ty: 0 })
  })

  it('ignores_buttons', () => {
    const { hook, onTap } = setup()
    const button = document.createElement('button')
    hook.rerender({ enabled: true })
    const el = button
    document.body.firstElementChild?.append(el)
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 10, clientY: 10 })
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 10, clientY: 10 })
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(onTap).not.toHaveBeenCalled()
  })

  it('pinch_then_lift_pans_without_tap', () => {
    const { hook, onTap, down, move, up } = setup()
    down(1, 150, 400)
    down(2, 250, 400)
    // 3배, 가운데점 100px 오른쪽 이동.
    move(2, 450, 400)
    expect(hook.result.current).toMatchObject({ scale: 3, tx: 100, ty: 0 })
    up(2, 450, 400)

    // 남은 손가락은 현재 위치부터 이동.
    move(1, 170, 420)
    expect(hook.result.current).toMatchObject({ scale: 3, tx: 120, ty: 20 })
    // 작은 움직임 뒤 떼어도 누르기 아님.
    up(1, 170, 420)
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(onTap).not.toHaveBeenCalled()
    expect(hook.result.current.scale).toBe(3)
  })

  it('pointercancel_is_not_tap', () => {
    const { onTap, down, up, cancel } = setup()
    down(1, 200, 400)
    cancel(1, 200, 400)
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(onTap).not.toHaveBeenCalled()

    // 취소 후 포인터 정리. 다음 누르기는 정상.
    now = 1000
    down(1, 200, 400)
    up(1, 200, 400)
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(onTap).toHaveBeenCalledTimes(1)
  })

  it('reset_cancels_pending_tap', () => {
    const { hook, onTap, down, up } = setup()
    down(1, 200, 400)
    up(1, 200, 400)
    act(() => {
      hook.result.current.reset()
    })
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(onTap).not.toHaveBeenCalled()

    // 넘긴 뒤 첫 누르기가 이전 사진 누르기와 두 번 누르기로 묶이지 않음.
    now = 100
    down(1, 200, 400)
    up(1, 200, 400)
    expect(hook.result.current.scale).toBe(1)
  })
})
