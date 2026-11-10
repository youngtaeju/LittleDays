import { Outlet } from '@tanstack/react-router'
import { OfflineBanner } from '@/pwa/OfflineBanner'
import { useSettings } from '@/settings/useSettings'
import { UploadPickerProvider } from '@/upload/picker'
import { UploadQueuePanel } from '@/upload/UploadQueue'
import { Sidebar } from './Sidebar'
import { TabBar } from './TabBar'

// 1024px 미만 하단 탭, 이상 왼쪽 사이드바.
export function AppShell() {
  const settings = useSettings()

  return (
    <UploadPickerProvider>
      <div className="min-h-dvh lg:flex">
        <Sidebar instanceName={settings?.instance_name} />
        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-10 bg-background">
            <OfflineBanner />
            {/* 데스크톱은 사이드바가 우리 집 이름 표시. */}
            <div className="flex h-14 items-center border-b border-border px-4 lg:hidden">
              <p className="truncate text-lg font-semibold">
                {settings?.instance_name}
              </p>
            </div>
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
