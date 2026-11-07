import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Listener = (e: { matches: boolean }) => void

describe('theme store', () => {
  const listeners: Listener[] = []
  const original = window.matchMedia.bind(window)

  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    listeners.length = 0
    window.matchMedia = (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        addEventListener: (_: string, l: Listener) => listeners.push(l),
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList
  })

  afterEach(() => {
    window.matchMedia = original
    document.documentElement.classList.remove('dark')
  })

  it('two_instances_stay_in_sync', async () => {
    const { useTheme } = await import('./theme')
    function Probe({ id }: { id: string }) {
      const [pref, setPref] = useTheme()
      return (
        <button
          data-testid={id}
          onClick={() => {
            setPref('dark')
          }}
        >
          {pref}
        </button>
      )
    }
    render(
      <>
        <Probe id="a" />
        <Probe id="b" />
      </>,
    )
    act(() => {
      screen.getByTestId('a').click()
    })
    expect(screen.getByTestId('b')).toHaveTextContent('dark')

    act(() => {
      listeners.forEach((l) => {
        l({ matches: false })
      })
    })
    expect(screen.getByTestId('a')).toHaveTextContent('dark')
    expect(document.documentElement).toHaveClass('dark')
  })
})
