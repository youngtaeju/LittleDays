import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import IconClose from '~icons/material-symbols/close-rounded'

// vite.config.ts 의 reactIcon 컴파일러 산출물 검증.
describe('icons', () => {
  it('renders_svg_with_props', () => {
    const { container } = render(
      <IconClose className="size-5" data-testid="x" />,
    )
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg).toHaveClass('size-5')
    expect(svg).toHaveAttribute('data-testid', 'x')
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24')
    expect(svg?.querySelector('path')).not.toBeNull()
  })

  it('decorative_by_default', () => {
    const { container } = render(<IconClose />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).not.toHaveAttribute('role')
  })

  it('labeled_icon_is_img', () => {
    const { getByRole } = render(<IconClose aria-label="닫기" />)
    const svg = getByRole('img', { name: '닫기' })
    expect(svg).not.toHaveAttribute('aria-hidden')
  })

  it('explicit_aria_hidden_wins', () => {
    const { container } = render(
      <IconClose aria-label="닫기" aria-hidden={false} />,
    )
    expect(container.querySelector('svg')).toHaveAttribute(
      'aria-hidden',
      'false',
    )
  })
})
