import { Outlet, useMatch } from '@tanstack/react-router'
import { useSyncExternalStore } from 'react'
import { HomeHeader } from '@/feed/HomeHeader'
import { cn } from '@/lib/utils'
import { OfflineBanner } from '@/pwa/OfflineBanner'
import { useSettings } from '@/settings/useSettings'
import { UploadPickerProvider } from '@/upload/picker'
import { UploadQueuePanel } from '@/upload/UploadQueue'
import { Sidebar } from './Sidebar'
import { TabBar } from './TabBar'

function subscribeScroll(onChange: () => void): () => void {
  window.addEventListener('scroll', onChange, { passive: true })
  return () => {
    window.removeEventListener('scroll', onChange)
  }
}

// 스크롤하면 머리글 아래 구분선.
function useScrolled(): boolean {
  return useSyncExternalStore(subscribeScroll, () => window.scrollY > 0)
}

// 1024px 미만 하단 탭, 이상 왼쪽 사이드바.
export function AppShell() {
  const settings = useSettings()
  const home = useMatch({ from: '/authed/shell/', shouldThrow: false })
  const scrolled = useScrolled()

  return (
    <UploadPickerProvider>
      <div className="min-h-dvh lg:flex">
        <Sidebar instanceName={settings?.instance_name} />
        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-10 bg-background">
            <div
              className={cn(
                'border-b',
                scrolled ? 'border-border' : 'border-transparent',
                // 데스크톱은 사이드바가 우리 집 이름 표시. 홈은 아기 이름·칩이라 유지.
                !home && 'lg:hidden',
              )}
            >
              {home ? (
                <HomeHeader instanceName={settings?.instance_name} />
              ) : (
                <div className="flex h-14 items-center px-4">
                  <p className="truncate text-lg font-semibold">
                    {settings?.instance_name}
                  </p>
                </div>
              )}
            </div>
            <OfflineBanner />
          </header>
          <main className="px-4 pt-4 pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-8">
            <UploadQueuePanel />
            <Outlet />
          </main>
        </div>
        <TabBar />
      </div>
    </UploadPickerProvider>
  )
}
