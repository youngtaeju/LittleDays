import { Outlet, useMatch, useRouterState } from '@tanstack/react-router'
import { Suspense, lazy, useSyncExternalStore } from 'react'
import { AgeAlbumHeader } from '@/babies/AgeAlbumHeader'
import { DayHeader } from '@/feed/DayHeader'
import { HomeHeader } from '@/feed/HomeHeader'
import { cn } from '@/lib/utils'
import { OfflineBanner } from '@/pwa/OfflineBanner'
import { useSettings } from '@/settings/useSettings'
import { UploadPickerProvider } from '@/upload/picker'
import { UploadPill } from '@/upload/UploadPill'
import { useQueueOpen } from '@/upload/useUploadStore'
import { Sidebar } from './Sidebar'
import { TabBar } from './TabBar'

// 시트·대화상자 청크는 처음 열 때 로딩.
const UploadQueueSheet = lazy(() =>
  import('@/upload/UploadQueueSheet').then((m) => ({
    default: m.UploadQueueSheet,
  })),
)

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
  const day = useMatch({
    from: '/authed/shell/days/$date',
    shouldThrow: false,
  })
  const album = useMatch({
    from: '/authed/shell/babies/$id/age/$age',
    shouldThrow: false,
  })
  // 나 탭 하위 화면은 MeSubPage 머리글. 셸 머리글은 오프라인 배너만.
  const meSub = useRouterState({
    select: (s) => /^\/me\/[^/]/.test(s.location.pathname),
  })
  const scrolled = useScrolled()
  const queueOpen = useQueueOpen()

  return (
    <UploadPickerProvider>
      <div className="min-h-dvh lg:flex">
        <Sidebar instanceName={settings?.instance_name} />
        <div className="min-w-0 flex-1">
          <header
            className={cn('bg-background', !meSub && 'sticky top-0 z-10')}
          >
            <div
              className={cn(
                meSub && 'hidden',
                'border-b',
                scrolled ? 'border-border' : 'border-transparent',
                // 데스크톱은 사이드바가 우리 집 이름 표시. 홈·그날·개월 앨범은 자체 머리글이라 유지.
                !home && !day && !album && 'lg:hidden',
              )}
            >
              {home ? (
                <HomeHeader instanceName={settings?.instance_name} />
              ) : day ? (
                <DayHeader />
              ) : album ? (
                <AgeAlbumHeader />
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
            <Outlet />
          </main>
        </div>
        <TabBar />
        {/* 모든 탭 공용. 탭 이동에도 유지. */}
        <UploadPill />
        {queueOpen && (
          <Suspense>
            <UploadQueueSheet />
          </Suspense>
        )}
      </div>
    </UploadPickerProvider>
  )
}
