import { render, screen } from '@testing-library/react'
import { initI18n } from '@/i18n'
import ko from '@/locales/ko.json'
import { json, mockFetch } from '@/test/fetch'
import { apiError } from '@/test/fixtures'
import App from './App'

describe('App', () => {
  it('logged_out_lands_on_login', async () => {
    initI18n('ko')
    mockFetch({
      'GET /api/auth/me': () => apiError(401, 'auth.required'),
      'GET /api/auth/status': () => json(200, { signup_open: false }),
    })
    render(<App />)
    expect(await screen.findByLabelText(ko.auth.username)).toBeInTheDocument()
    expect(location.pathname).toBe('/login')
  })
})
