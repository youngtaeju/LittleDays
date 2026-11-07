import type { QueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
  type RouterHistory,
} from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { Role, User } from '@/api/types'
import { authStatusQuery, hasRole, loadMe } from '@/auth/session'
import { applyUserLocale } from '@/i18n'
import { InvitePage } from '@/pages/InvitePage'
import { LoginPage } from '@/pages/LoginPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { SignupPage } from '@/pages/SignupPage'
import { AppShell } from '@/shell/AppShell'

interface RouterContext {
  queryClient: QueryClient
}

// 제목만 있는 자리 화면.
function Placeholder({ title }: { title: string }) {
  const { t } = useTranslation()
  return <h1 className="text-lg font-semibold">{t(title)}</h1>
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
  component: SignupPage,
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
    // 셸 밖 화면(/photo/$id) 직접 진입 포함, 로그인 화면 공통 지점.
    if (me) applyUserLocale(me.locale)
    return { me }
  },
})

function requireRole(min: Role) {
  return ({ context }: { context: { me?: User } }) => {
    if (context.me && !hasRole(context.me, min)) throw redirect({ to: '/' })
  }
}

const shellRoute = createRoute({
  getParentRoute: () => authedRoute,
  id: 'shell',
  component: AppShell,
})

const timelineRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/',
  validateSearch: (s: Record<string, unknown>): { baby?: string } => ({
    baby: typeof s.baby === 'string' ? s.baby : undefined,
  }),
  component: () => <Placeholder title="nav.timeline" />,
})

const uploadRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/upload',
  beforeLoad: requireRole('guardian'),
  component: () => <Placeholder title="nav.upload" />,
})

const babiesRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/babies',
  component: () => <Placeholder title="nav.babies" />,
})

const trashRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/trash',
  beforeLoad: requireRole('guardian'),
  component: () => <Placeholder title="nav.trash" />,
})

const membersRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/members',
  beforeLoad: requireRole('owner'),
  component: () => <Placeholder title="nav.members" />,
})

const settingsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/settings',
  component: () => <Placeholder title="nav.settings" />,
})

// 뷰어는 셸 없이 전체 화면.
const photoRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/photo/$id',
  component: () => <Placeholder title="photo.title" />,
})

const routeTree = rootRoute.addChildren([
  loginRoute,
  signupRoute,
  inviteRoute,
  authedRoute.addChildren([
    shellRoute.addChildren([
      timelineRoute,
      uploadRoute,
      babiesRoute,
      trashRoute,
      membersRoute,
      settingsRoute,
    ]),
    photoRoute,
  ]),
])

export function createAppRouter(
  queryClient: QueryClient,
  history?: RouterHistory,
) {
  return createRouter({ routeTree, context: { queryClient }, history })
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
