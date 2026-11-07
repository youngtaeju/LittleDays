import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyTheme, getThemePref } from './theme'

afterEach(() => {
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

  it('storage_failure_defaults_to_system', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(getThemePref()).toBe('system')
  })
})
