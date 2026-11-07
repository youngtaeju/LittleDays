import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { initTheme } from './theme/theme'

initTheme()

const root = document.getElementById('root')
if (!root) throw new Error('#root 없음')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
