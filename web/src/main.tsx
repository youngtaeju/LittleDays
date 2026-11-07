import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { initI18n, pickLocale } from './i18n'
import { initTheme } from './theme/theme'

initTheme()
// 로그인 전 기본값. 로그인 후 user.locale 적용.
initI18n(pickLocale(null, navigator.language))

const root = document.getElementById('root')
if (!root) throw new Error('#root 없음')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
