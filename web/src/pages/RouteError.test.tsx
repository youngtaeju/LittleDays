import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '@/i18n'
import ko from '@/locales/ko.json'
import { RouteError } from './RouteError'

beforeEach(() => {
  initI18n('ko')
})

describe('RouteError', () => {
  it('reload_button_reloads_page', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { reload })
    render(<RouteError />)
    expect(screen.getByText(ko.routeError.title)).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: ko.routeError.reload }),
    )
    expect(reload).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })
})
