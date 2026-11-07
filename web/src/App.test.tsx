import { render, screen } from '@testing-library/react'
import App from './App'

describe('App', () => {
  it('renders_root', () => {
    render(<App />)
    expect(screen.getByTestId('app-root')).toBeInTheDocument()
  })
})
