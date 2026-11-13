import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  redirect,
  useRouter,
  type RouterHistory,
} from '@tanstack/react-router'
import type { Role, User } from '@/api/types'
import {
  authStatusQuery,
  hasRole,
  isMeUnreachable,
  loadMe,
} from '@/auth/session'
import { applyUserLocale } from '@/i18n'
import { LoginPage } from '@/pages/LoginPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { OfflineScreen } from '@/pwa/OfflineBanner'
import { RouteError, RoutePending } from '@/pages/RouteError'
import { AppShell } from '@/shell/AppShell'
import { FeedPage } from '@/feed/FeedPage'
import { pickBaby } from '@/babies/lastBaby'
import { parseAgeParam } from '@/babies/useBabyStats'
import { babiesQuery } from '@/timeline/useBabies'
import { storyQuery } from '@/stories/useStory'
import { isMonth } from '@/calendar/month'
import { isCalendarDate } from '@/lib/dates'
import { uploadStore } from '@/upload/useUploadStore'

// 홈 피드·로그인·셸만 메인 번들. 나머지 화면은 첫 진입 때 청크 로드.
const InvitePage = lazyRouteComponent(
  () => import('@/pages/InvitePage'),
  'InvitePage',
)
const SignupWizard = lazyRouteComponent(
  () => import('@/pages/SignupWizard'),
  'SignupWizard',
)
const FamilyPage = lazyRouteComponent(
  () => import('@/family/FamilyPage'),
  'FamilyPage',
)
const MePage = lazyRouteComponent(() => import('@/me/MePage'), 'MePage')
const ProfilePage = lazyRouteComponent(
  () => import('@/me/subPages'),
  'ProfilePage',
)
const PasswordPage = lazyRouteComponent(
  () => import('@/me/subPages'),
  'PasswordPage',
)
const DevicesPage = lazyRouteComponent(
  () => import('@/me/subPages'),
  'DevicesPage',
)
const AppearancePage = lazyRouteComponent(
  () => import('@/me/subPages'),
  'AppearancePage',
)
const InstancePage = lazyRouteComponent(
  () => import('@/me/subPages'),
  'InstancePage',
)
const BabiesIndexPage = lazyRouteComponent(
  () => import('@/babies/BabiesIndexPage'),
  'BabiesIndexPage',
)
const BabyProfilePage = lazyRouteComponent(
  () => import('@/babies/BabyProfilePage'),
  'BabyProfilePage',
)
const AgeAlbumPage = lazyRouteComponent(
  () => import('@/babies/AgeAlbumPage'),
  'AgeAlbumPage',
)
const GrowthListPage = lazyRouteComponent(
  () => import('@/growth/GrowthListPage'),
  'GrowthListPage',
)
const FavoritesPage = lazyRouteComponent(
  () => import('@/favorites/FavoritesPage'),
  'FavoritesPage',
)
const AlbumsPage = lazyRouteComponent(
  () => import('@/albums/AlbumsPage'),
  'AlbumsPage',
)
const VideosPage = lazyRouteComponent(
  () => import('@/albums/VideosPage'),
  'VideosPage',
)
const AlbumPage = lazyRouteComponent(
  () => import('@/albums/AlbumPage'),
  'AlbumPage',
)
const TrashPage = lazyRouteComponent(
  () => import('@/trash/TrashPage'),
  'TrashPage',
)
const DayPage = lazyRouteComponent(() => import('@/feed/DayPage'), 'DayPage')
const CalendarPage = lazyRouteComponent(
  () => import('@/calendar/CalendarPage'),
  'CalendarPage',
)
const StoryNewPage = lazyRouteComponent(
  () => import('@/stories/StoryEditor'),
  'StoryNewPage',
)
const StoryPage = lazyRouteComponent(
  () => import('@/stories/StoryPage'),
  'StoryPage',
)
const StoryEditPage = lazyRouteComponent(
  () => import('@/stories/StoryEditor'),
  'StoryEditPage',
)
const MilestonePage = lazyRouteComponent(
  () => import('@/milestones/MilestonePage'),
  'MilestonePage',
)
const ViewerPage = lazyRouteComponent(
  () => import('@/viewer/ViewerPage'),
  'ViewerPage',
)

interface RouterContext {
  queryClient: QueryClient
}

// 같은 앱 경로만 허용. 브라우저가 제어문자·역슬래시를 지우거나 / 로 바꿔
// `//host` 가 되는 경우 차단. 퍼센트 인코딩 해제 후에도 검사.
function isAppPath(v: string): boolean {
  return (
    v.startsWith('/') &&
    !v.startsWith('//') &&
    !v.includes('\\') &&
    // eslint-disable-next-line no-control-regex
    !/[\x00-\x1f\x7f]/.test(v)
  )
}

function safeRedirect(v: unknown): string | undefined {
  if (typeof v !== 'string' || !isAppPath(v)) return undefined
  try {
    return isAppPath(decodeURIComponent(v)) ? v : undefined
  } catch {
    return undefined
  }
}

// 홈·그날·뷰어 공용. baby = 목록·이전/다음 필터.
function babySearch(s: Record<string, unknown>): { baby?: string } {
  return { baby: typeof s.baby === 'string' ? s.baby : undefined }
}

// 문자열 아닌 값(숫자로 해석된 202611 등)은 빈 문자열. 형식 검사에서 걸러짐.
function searchText(v: unknown): string | undefined {
  if (v === undefined) return undefined
  return typeof v === 'string' ? v : ''
}

// 달력. month = YYYY-MM, date = 고른 날. 검사는 beforeLoad 와 화면에서.
function calendarSearch(s: Record<string, unknown>): {
  month?: string
  date?: string
  baby?: string
} {
  return {
    ...babySearch(s),
    month: searchText(s.month),
    date: searchText(s.date),
  }
}

// 뷰어 전용. from = 이전/다음 목록(없으면 타임라인), of = 이야기, 마일스톤, 앨범 id.
// 그 밖의 값, of 없는 story/milestone/album 은 버림. of 는 story/milestone/album 일 때만.
function viewerSearch(s: Record<string, unknown>): {
  baby?: string
  from?: 'favorites' | 'videos' | 'story' | 'milestone' | 'album'
  of?: string
} {
  const of = typeof s.of === 'string' && s.of !== '' ? s.of : undefined
  const from =
    s.from === 'favorites' || s.from === 'videos'
      ? s.from
      : (s.from === 'story' || s.from === 'milestone' || s.from === 'album') &&
          of
        ? s.from
        : undefined
  return {
    ...babySearch(s),
    from,
    of:
      from === 'story' || from === 'milestone' || from === 'album'
        ? of
        : undefined,
  }
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  notFoundComponent: NotFoundPage,
})

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  // 검증 결과에 없는 키는 원래 search 값이 남으므로 undefined 로 명시해 덮어씀.
  validateSearch: (s: Record<string, unknown>): { redirect?: string } => ({
    redirect: safeRedirect(s.redirect),
  }),
  beforeLoad: async ({ context }) => {
    if (await loadMe(context.queryClient)) throw redirect({ to: '/' })
  },
  component: LoginPage,
})

const signupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/signup',
  beforeLoad: async ({ context }) => {
    // 조회 실패 시 화면 유지. 최종 판단은 서버(auth.signupClosed).
    const status = await context.queryClient
      .query(authStatusQuery)
      .catch(() => undefined)
    if (status && !status.signup_open) throw redirect({ to: '/login' })
  },
  component: SignupWizard,
})

const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invite/$raw',
  beforeLoad: async ({ context }) => {
    if (await loadMe(context.queryClient)) throw redirect({ to: '/' })
  },
  component: InvitePage,
})

// 로그인 필요. me 확인 불가(오프라인 등)면 통과, 서버가 최종 검증.
const authedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'authed',
  beforeLoad: async ({ context, location }): Promise<{ me?: User }> => {
    const me = await loadMe(context.queryClient)
    if (me === null) {
      throw redirect({
        to: '/login',
        search: location.href === '/' ? {} : { redirect: location.href },
      })
    }
    // 셸 밖 화면(/photos/$id) 직접 진입 포함, 로그인 화면 공통 지점.
    if (me) applyUserLocale(me.locale)
    return { me }
  },
  component: AuthedGate,
})

// me 확인 불가이고 캐시도 없으면 오프라인 화면. 하위 화면의 요청 방지.
function AuthedGate() {
  const { me } = authedRoute.useRouteContext()
  const qc = useQueryClient()
  const router = useRouter()
  if (me === undefined && isMeUnreachable(qc)) {
    return <OfflineScreen onRetry={() => router.invalidate()} />
  }
  return <Outlet />
}

function requireRole(min: Role, to: '/' | '/me' = '/') {
  return ({ context }: { context: { me?: User } }) => {
    if (context.me && !hasRole(context.me, min)) {
      throw redirect({ to, replace: true })
    }
  }
}

const shellRoute = createRoute({
  getParentRoute: () => authedRoute,
  id: 'shell',
  component: AppShell,
})

const homeRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/',
  validateSearch: babySearch,
  component: FeedPage,
})

const dayRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/days/$date',
  validateSearch: babySearch,
  // 형식·실존 날짜가 아니면 홈. 서버 요청 전에 차단.
  beforeLoad: ({ params, search }) => {
    if (!isCalendarDate(params.date)) {
      throw redirect({ to: '/', search, replace: true })
    }
  },
  component: DayPage,
})

// 형식, 실존 날짜가 아니면 search 없이 교체 이동. 이번 달 이후는 인스턴스 오늘 기준이라 화면에서.
const calendarRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/calendar',
  validateSearch: calendarSearch,
  beforeLoad: ({ search }) => {
    if (
      (search.month !== undefined && !isMonth(search.month)) ||
      (search.date !== undefined && !isCalendarDate(search.date))
    ) {
      throw redirect({ to: '/calendar', replace: true })
    }
  },
  component: CalendarPage,
})

// 마지막 본 아기(없으면 첫째)로 교체 이동. 아기 없음·조회 실패는 화면에서.
const babiesRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/babies',
  beforeLoad: async ({ context }) => {
    // 캐시 있으면 그대로(화면이 다시 받음).
    const babies = await context.queryClient
      .query({ ...babiesQuery, staleTime: 'static' })
      .catch(() => undefined)
    const target = babies && pickBaby(babies)
    if (target) {
      throw redirect({
        to: '/babies/$id',
        params: { id: target.id },
        replace: true,
      })
    }
  },
  component: BabiesIndexPage,
})

const babyRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/babies/$id',
  component: BabyProfilePage,
})

// 개월 수(정수) 또는 before 가 아니면 아기 화면. 통계에 없는 개월은 화면에서.
const ageAlbumRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/babies/$id/age/$age',
  beforeLoad: ({ params }) => {
    if (parseAgeParam(params.age) === null) {
      throw redirect({
        to: '/babies/$id',
        params: { id: params.id },
        replace: true,
      })
    }
  },
  component: AgeAlbumPage,
})

// 모든 멤버 읽기. 고치기와 지우기는 화면에서 보호자 이상만.
const growthRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/babies/$id/growth',
  component: GrowthListPage,
})

// date: 그날 화면에서 진입 시 기본 날짜. 미래 날짜는 화면이 오늘로.
const storyNewRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/stories/new',
  validateSearch: (s: Record<string, unknown>): { date?: string } => ({
    date:
      typeof s.date === 'string' && isCalendarDate(s.date) ? s.date : undefined,
  }),
  beforeLoad: requireRole('guardian'),
  component: StoryNewPage,
})

const storyRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/stories/$id',
  component: StoryPage,
})

// 작성자만. 아니면 상세로. 조회 실패(오프라인 등)는 화면에서.
const storyEditRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/stories/$id/edit',
  beforeLoad: async ({ context, params }) => {
    requireRole('guardian')({ context })
    // 고치기 시작 값은 최신 상세.
    const story = await context.queryClient
      .query({ ...storyQuery(params.id), staleTime: 0 })
      .catch(() => undefined)
    if (story && context.me && story.author_id !== context.me.id) {
      throw redirect({ to: '/stories/$id', params, replace: true })
    }
  },
  component: StoryEditPage,
})

// 모든 멤버 읽기. 고치기와 지우기는 화면에서 보호자 이상만.
const milestoneRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/milestones/$id',
  component: MilestonePage,
})

// 모든 멤버. 초대·역할 변경은 화면에서 관리자만.
const familyRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/family',
  component: FamilyPage,
})

const meRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/me',
  component: MePage,
})

const meProfileRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/me/profile',
  component: ProfilePage,
})

const mePasswordRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/me/password',
  component: PasswordPage,
})

const meDevicesRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/me/devices',
  component: DevicesPage,
})

const meAppearanceRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/me/appearance',
  component: AppearancePage,
})

const meInstanceRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/me/instance',
  beforeLoad: requireRole('owner', '/me'),
  component: InstancePage,
})

// 모든 멤버 읽기.
const albumsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/albums',
  component: AlbumsPage,
})

const favoritesRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/albums/favorites',
  component: FavoritesPage,
})

const videosRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/albums/videos',
  component: VideosPage,
})

// 고정 경로(/albums/favorites, /albums/videos)가 먼저 매칭(라우터 순위).
const albumRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/albums/$id',
  component: AlbumPage,
})

const trashRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/me/trash',
  beforeLoad: requireRole('guardian', '/me'),
  component: TrashPage,
})

// 뷰어는 셸 없이 전체 화면.
const photoRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/photos/$id',
  validateSearch: viewerSearch,
  component: ViewerPage,
})

// 예전 주소. 로그인 확인 전 새 주소로 교체 이동(기록에 남지 않음).
const legacyPhotoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/photo/$id',
  validateSearch: viewerSearch,
  beforeLoad: ({ params, search }) => {
    throw redirect({ to: '/photos/$id', params, search, replace: true })
  },
})

// 예전 업로드 화면. 홈으로 가며 큐가 있으면 업로드 목록 시트 열기.
const legacyUploadRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/upload',
  beforeLoad: () => {
    if (uploadStore.getSnapshot().length > 0) uploadStore.openQueue()
    throw redirect({ to: '/', replace: true })
  },
})

// 경로 리터럴 유지(라우터 주소 타입 검사).
function legacyRoute<P extends string>(
  path: P,
  to: '/family' | '/me' | '/me/trash' | '/albums/favorites',
) {
  return createRoute({
    getParentRoute: () => rootRoute,
    path,
    beforeLoad: () => {
      throw redirect({ to, replace: true })
    },
  })
}

const routeTree = rootRoute.addChildren([
  loginRoute,
  signupRoute,
  inviteRoute,
  legacyPhotoRoute,
  legacyRoute('/members', '/family'),
  legacyRoute('/settings', '/me'),
  legacyUploadRoute,
  legacyRoute('/trash', '/me/trash'),
  legacyRoute('/me/favorites', '/albums/favorites'),
  authedRoute.addChildren([
    shellRoute.addChildren([
      homeRoute,
      dayRoute,
      calendarRoute,
      babiesRoute,
      babyRoute,
      ageAlbumRoute,
      growthRoute,
      storyNewRoute,
      storyRoute,
      storyEditRoute,
      milestoneRoute,
      familyRoute,
      meRoute,
      meProfileRoute,
      mePasswordRoute,
      meDevicesRoute,
      meAppearanceRoute,
      meInstanceRoute,
      albumsRoute,
      favoritesRoute,
      videosRoute,
      albumRoute,
      trashRoute,
    ]),
    photoRoute,
  ]),
])

export function createAppRouter(
  queryClient: QueryClient,
  history?: RouterHistory,
) {
  return createRouter({
    routeTree,
    context: { queryClient },
    history,
    // 청크 로드 실패 등 라우트 오류는 새로고침 안내.
    defaultErrorComponent: RouteError,
    defaultPendingComponent: RoutePending,
    // 뷰어를 닫고 돌아오면 홈 스크롤 위치 복원.
    scrollRestoration: true,
  })
}

export type AppRouter = ReturnType<typeof createAppRouter>

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter
  }
}

// 쿼리 클라이언트의 로그아웃 콜백이 라우터 참조.
export function createApp(
  makeQueryClient: (onLogout: () => void) => QueryClient,
  history?: RouterHistory,
): { queryClient: QueryClient; router: AppRouter } {
  let navigating = false
  const queryClient = makeQueryClient(() => {
    // 병렬 401 대응. 이동 중이거나 이미 로그인 화면이면 무시.
    if (navigating || router.latestLocation.pathname === '/login') return
    navigating = true
    void router
      .navigate({
        to: '/login',
        search: { redirect: router.latestLocation.href },
      })
      .finally(() => {
        navigating = false
      })
  })
  // 콜백 호출은 첫 요청 응답 이후. 그 시점엔 router 초기화 완료.
  const router = createAppRouter(queryClient, history)
  return { queryClient, router }
}
