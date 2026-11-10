import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { NativeSelect } from '@/components/NativeSelect'
import { Button } from './button'
import { Checkbox } from './checkbox'
import { Input } from './input'
import { Textarea } from './textarea'

// 전역 :focus-visible 외곽선(강조 글자색, 2px)을 끄거나 반투명 링으로 대체하지 않음(WCAG 1.4.11).
describe('focus ring', () => {
  it('controls_keep_global_focus_outline', () => {
    const { container } = render(
      <>
        <Button>a</Button>
        <Button variant="destructive">b</Button>
        <Input aria-label="c" />
        <Textarea aria-label="d" />
        <Checkbox aria-label="e" />
        <NativeSelect aria-label="f" />
      </>,
    )
    const controls = container.querySelectorAll(
      'button, input, textarea, select',
    )
    expect(controls).toHaveLength(6)
    for (const el of controls) {
      expect(el.className).not.toMatch(/(^|\s)outline-none(\s|$)/)
      expect(el.className).not.toMatch(
        /ring-ring\/50|focus-visible:ring-\[3px\]/,
      )
    }
  })
})
