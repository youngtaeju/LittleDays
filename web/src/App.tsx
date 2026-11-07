import { QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { Toaster } from '@/components/ui/sonner'
import { createQueryClient } from '@/auth/session'
import { initI18n, pickLocale } from '@/i18n'
import { useTheme } from '@/theme/theme'

initI18n(pickLocale(null, navigator.language))

export default function App() {
  const [theme] = useTheme()
  // 로그아웃 후 이동은 라우터 도입 시 연결.
  const [queryClient] = useState(() => createQueryClient(() => undefined))
  return (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <div data-testid="app-root" />
        <Toaster theme={theme} />
      </I18nextProvider>
    </QueryClientProvider>
  )
}
