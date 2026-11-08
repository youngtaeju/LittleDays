import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyTheme, getThemePref } from './theme'

afterEach(() => {
  document.head.querySelector('meta[data-app-theme]')?.remove()
  document.documentElement.classList.remove('dark')
  vi.restoreAllMocks()
})

describe('theme', () => {
  it('system_follows_media', () => {
    applyTheme('system', true)
    expect(document.documentElement).toHaveClass('dark')
    applyTheme('system', false)
    expect(document.documentElement).not.toHaveClass('dark')
  })

  it('explicit_overrides_system', () => {
    applyTheme('light', true)
    expect(document.documentElement).not.toHaveClass('dark')
    applyTheme('dark', false)
    expect(document.documentElement).toHaveClass('dark')
  })

  it('theme_color_follows_choice', () => {
    applyTheme('light', true)
    const metas = () =>
      document.head.querySelectorAll<HTMLMetaElement>(
        'meta[name="theme-color"]:not([media])',
      )
    expect(metas()).toHaveLength(1)
    expect(metas()[0]?.content).toBe('#F5F7F6')
    applyTheme('system', true)
    expect(metas()).toHaveLength(1)
    expect(metas()[0]?.content).toBe('#14181B')
    expect(document.head.querySelector('meta[name="theme-color"]')).toBe(
      metas()[0],
    )
  })

  it('storage_failure_defaults_to_system', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(getThemePref()).toBe('system')
  })
})
