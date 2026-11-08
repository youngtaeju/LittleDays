import { Outlet } from '@tanstack/react-router'
import { OfflineBanner } from '@/pwa/OfflineBanner'
import { useSettings } from '@/settings/useSettings'
import { NavRail, NavTabs } from './NavTabs'

// 모바일 하단 탭, 1024px 이상 왼쪽 레일.
export function AppShell() {
  const settings = useSettings()

  return (
    <div className="min-h-dvh lg:flex">
      <NavRail />
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-10 border-b border-border bg-background">
          <OfflineBanner />
          <div className="flex h-14 items-center px-4">
            <p className="truncate text-lg font-semibold">
              {settings?.instance_name}
            </p>
          </div>
        </header>
        <main className="px-4 pt-4 pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-8">
          <Outlet />
        </main>
      </div>
      <NavTabs />
    </div>
  )
}
