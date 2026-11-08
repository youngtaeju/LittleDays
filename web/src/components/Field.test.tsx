import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ApiError } from '@/api/errors'
import { initI18n } from '@/i18n'
import { FormError } from './Field'

beforeEach(() => {
  initI18n('ko')
})

afterEach(cleanup)

describe('FormError', () => {
  it('form_error_hides_logout', () => {
    render(<FormError error={new ApiError(401, 'auth.required', {})} />)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('form_error_shows_disabled', () => {
    render(<FormError error={new ApiError(401, 'auth.disabled', {})} />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('form_error_shows_invalid_credentials', () => {
    render(
      <FormError error={new ApiError(401, 'auth.invalidCredentials', {})} />,
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
