import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { useState } from 'react'
import { Toaster } from '@/components/ui/sonner'
import { createQueryClient } from '@/auth/session'
import { createApp, type AppRouter } from '@/router'
import { useTheme } from '@/theme/theme'

export function AppView({
  queryClient,
  router,
}: {
  queryClient: QueryClient
  router: AppRouter
}) {
  const [theme] = useTheme()
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster theme={theme} />
    </QueryClientProvider>
  )
}

export default function App() {
  const [app] = useState(() => createApp(createQueryClient))
  return <AppView {...app} />
}
