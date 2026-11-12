import {
  Outlet,
  useMatch,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router'
import { Suspense, lazy, useState, useSyncExternalStore } from 'react'
import { AgeAlbumHeader } from '@/babies/AgeAlbumHeader'
import { DayHeader } from '@/feed/DayHeader'
import { HomeHeader } from '@/feed/HomeHeader'
import { cn } from '@/lib/utils'
import { OfflineBanner } from '@/pwa/OfflineBanner'
import { useSettings } from '@/settings/useSettings'
import { UploadPickerProvider, useUploadPicker } from '@/upload/picker'
import { UploadPill } from '@/upload/UploadPill'
import { useQueueOpen } from '@/upload/useUploadStore'
import { AddSheet } from './AddSheet'
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

// 휴대폰 (+), 데스크톱 사이드바 공용 추가 시트 하나. 항목 동작 연결 지점.
// 키/몸무게, 마일스톤은 기록 시트 연결 전까지 아기 화면.
function ShellAddSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const picker = useUploadPicker()
  const toBabies = () => {
    void navigate({ to: '/babies' })
  }
  return (
    <AddSheet
      open={open}
      onOpenChange={onOpenChange}
      onUpload={picker.open}
      onStory={() => {
        void navigate({ to: '/stories/new' })
      }}
      onGrowth={toBabies}
      onMilestone={toBabies}
    />
  )
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
  // 나 탭 하위 화면(MeSubPage), 이야기 화면(쓰기, 상세, 고치기)은 자체 머리글. 셸 머리글은 오프라인 배너만.
  const ownHeader = useRouterState({
    select: (s) =>
      /^\/me\/[^/]/.test(s.location.pathname) ||
      /^\/stories\/[^/]+(\/edit)?$/.test(s.location.pathname),
  })
  // 이야기 쓰기와 고치기는 전체 화면. 휴대폰 하단 탭 없음.
  const fullScreen = useRouterState({
    select: (s) => /^\/stories\/(new|[^/]+\/edit)$/.test(s.location.pathname),
  })
  const scrolled = useScrolled()
  const queueOpen = useQueueOpen()
  const [addOpen, setAddOpen] = useState(false)
  const openAdd = () => {
    setAddOpen(true)
  }

  return (
    <UploadPickerProvider>
      <div className="min-h-dvh lg:flex">
        <Sidebar instanceName={settings?.instance_name} onAdd={openAdd} />
        <div className="min-w-0 flex-1">
          <header
            className={cn('bg-background', !ownHeader && 'sticky top-0 z-10')}
          >
            <div
              className={cn(
                ownHeader && 'hidden',
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
          <main
            className={cn(
              'px-4 pt-4 lg:pb-8',
              fullScreen
                ? 'pb-[calc(2rem+env(safe-area-inset-bottom))]'
                : 'pb-[calc(5rem+env(safe-area-inset-bottom))]',
            )}
          >
            <Outlet />
          </main>
        </div>
        {!fullScreen && <TabBar onAdd={openAdd} />}
        <ShellAddSheet open={addOpen} onOpenChange={setAddOpen} />
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
