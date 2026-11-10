import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initI18n } from '@/i18n'
import { AvatarCropper } from './AvatarCropper'
import { centerCrop, type AvatarCrop } from './crop'

beforeEach(() => {
  initI18n('ko')
})

afterEach(cleanup)

const W = 4000
const H = 3000

function renderCropper(initial: AvatarCrop = centerCrop(W, H)) {
  const seen: AvatarCrop[] = []
  function Harness() {
    const [crop, setCrop] = useState(initial)
    return (
      <AvatarCropper
        assetId="a1"
        width={W}
        height={H}
        crop={crop}
        onChange={(c) => {
          seen.push(c)
          setCrop(c)
        }}
      />
    )
  }
  render(<Harness />)
  const last = () => {
    const c = seen.at(-1)
    if (!c) throw new Error('변경 없음')
    return c
  }
  return { seen, last }
}

function drag(el: HTMLElement, dx: number, dy: number) {
  fireEvent.pointerDown(el, { pointerId: 1, clientX: 100, clientY: 100 })
  fireEvent.pointerMove(el, {
    pointerId: 1,
    clientX: 100 + dx,
    clientY: 100 + dy,
  })
  fireEvent.pointerUp(el, {
    pointerId: 1,
    clientX: 100 + dx,
    clientY: 100 + dy,
  })
}

function expectFits(c: AvatarCrop) {
  const side = c.size * Math.min(W, H)
  expect(c.x).toBeGreaterThanOrEqual(0)
  expect(c.y).toBeGreaterThanOrEqual(0)
  expect(c.x * W + side).toBeLessThanOrEqual(W + 1e-6)
  expect(c.y * H + side).toBeLessThanOrEqual(H + 1e-6)
}

describe('AvatarCropper', () => {
  it('cropper_outputs_bounded_crop', () => {
    const { seen, last } = renderCropper()
    const stage = screen.getByRole('group', { name: '사진 위치' })
    const zoom = screen.getByRole('slider', { name: '확대' })

    // 2배 확대 → 한 변 0.5, 가운데 유지.
    fireEvent.change(zoom, { target: { value: '2' } })
    expect(last().size).toBe(0.5)
    expect(zoom).toHaveAttribute('aria-valuetext', '2배')
    fireEvent.change(zoom, { target: { value: '3.5' } })
    expect(zoom).toHaveAttribute('aria-valuetext', '3.5배')
    fireEvent.change(zoom, { target: { value: '2' } })

    // 사진을 끝까지 끌어도 영역은 이미지 안.
    for (const [dx, dy] of [
      [5000, 0],
      [-5000, 0],
      [0, 5000],
      [0, -5000],
    ] as const) {
      drag(stage, dx, dy)
      expectFits(last())
    }
    // 마지막: 위로 끝까지 → 영역은 아래 끝.
    expect(last().y * H + last().size * H).toBeCloseTo(H)

    // 오른쪽으로 끌면 영역은 왼쪽 끝.
    drag(stage, 5000, 0)
    expect(last().x).toBe(0)
    for (const c of seen) expectFits(c)
  })

  it('keyboard_moves_and_zooms', () => {
    const { last } = renderCropper()
    const stage = screen.getByRole('group', { name: '사진 위치' })
    fireEvent.keyDown(stage, { key: '+' })
    expect(last().size).toBeLessThan(1)
    const before = last()
    // 오른쪽 화살표 = 사진을 오른쪽으로 → 영역은 왼쪽.
    fireEvent.keyDown(stage, { key: 'ArrowRight' })
    expect(last().x).toBeLessThan(before.x)
    fireEvent.keyDown(stage, { key: 'ArrowDown' })
    expect(last().y).toBeLessThan(before.y)
    fireEvent.keyDown(stage, { key: '-' })
    expect(last().size).toBe(1)
    expectFits(last())
  })

  it('pinch_zooms', () => {
    const { last } = renderCropper()
    const stage = screen.getByRole('group', { name: '사진 위치' })
    fireEvent.pointerDown(stage, { pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerDown(stage, { pointerId: 2, clientX: 200, clientY: 100 })
    // 손가락 사이 2배.
    fireEvent.pointerMove(stage, { pointerId: 2, clientX: 300, clientY: 100 })
    expect(last().size).toBeCloseTo(0.5)
    fireEvent.pointerUp(stage, { pointerId: 2 })
    fireEvent.pointerUp(stage, { pointerId: 1 })
  })
})
