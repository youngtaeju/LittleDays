import {
  MutationCache,
  QueryCache,
  QueryClient,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { api, call } from '@/api/client'
import { ApiError, isLogoutError } from '@/api/errors'
import type { Role, User } from '@/api/types'
import { applyUserLocale } from '@/i18n'
// Uppy 없는 store 모듈만. 업로더 지연 청크 경계 유지.
import { clearUploads } from '@/upload/useUploadStore'

export const meQueryKey = ['me'] as const

export const meQuery = queryOptions({
  queryKey: meQueryKey,
  queryFn: async (): Promise<User | null> => {
    try {
      return (await call(api.GET('/api/auth/me'))).user
    } catch (e) {
      // 비로그인 상태는 에러가 아님. 세션 만료 포함이라 이전 사용자 오프라인 캐시·업로드 목록 삭제.
      if (e instanceof ApiError && e.status === 401) {
        clearUploads()
        clearOfflineCaches()
        return null
      }
      throw e
    }
  },
  // 세션 상실은 다른 요청의 401 로 감지. 가드와 셸의 중복 조회 방지.
  staleTime: 5 * 60_000,
})

export const authStatusQuery = queryOptions({
  queryKey: ['auth', 'status'],
  queryFn: () => call(api.GET('/api/auth/status')),
})

export function useMe(): { user: User | null; isLoading: boolean } {
  const { data, isLoading } = useQuery(meQuery)
  return { user: data ?? null, isLoading }
}

// 라우트 가드용. null = 비로그인, undefined = 확인 불가(네트워크 실패 등).
export async function loadMe(
  qc: QueryClient,
): Promise<User | null | undefined> {
  try {
    // 화면의 관찰자(networkMode online)가 오프라인에서 일시정지한 조회는
    // qc.query 가 그대로 이어받아 온라인 복귀까지 대기. 먼저 취소.
    if (qc.getQueryState(meQueryKey)?.fetchStatus === 'paused') {
      await qc.cancelQueries({ queryKey: meQueryKey })
    }
    // 오프라인에서 이동마다 재시도 대기 방지. 브라우저 오프라인 상태여도
    // 일시정지 없이 바로 실패(networkMode 기본값 online 은 온라인 복귀까지 대기).
    return await qc.query({ ...meQuery, retry: false, networkMode: 'always' })
  } catch {
    return undefined
  }
}

// me 를 모르고(네트워크 실패) 캐시도 없음. 오프라인 전체 화면 조건.
export function isMeUnreachable(qc: QueryClient): boolean {
  const state = qc.getQueryState(meQueryKey)
  return (
    state?.data === undefined &&
    state?.error instanceof ApiError &&
    state.error.key === 'network.offline'
  )
}

const roleRank: Record<Role, number> = { family: 0, guardian: 1, owner: 2 }

export function hasRole(user: User | null | undefined, min: Role): boolean {
  return user != null && roleRank[user.role] >= roleRank[min]
}

// 로그인·가입·초대 수락 성공 공용.
export function setSignedIn(qc: QueryClient, user: User): void {
  qc.setQueryData(meQueryKey, user)
  applyUserLocale(user.locale)
}

// 서비스 워커 런타임 캐시(vite.config.ts). 남기면 세션 없이도 이전 사용자 응답 제공.
function clearOfflineCaches(): void {
  if (!('caches' in window)) return
  for (const name of ['ld-api', 'ld-derivatives']) {
    caches.delete(name).catch(() => undefined)
  }
}

// 강제·직접 로그아웃 공용. 이전 사용자 데이터·업로드 큐 제거 후 비로그인 확정.
function setSignedOut(qc: QueryClient): void {
  clearUploads()
  clearOfflineCaches()
  qc.clear()
  qc.setQueryData(meQueryKey, null)
  applyUserLocale(null)
}

export function createQueryClient(onLogout: () => void): QueryClient {
  const qc: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (e) => {
        handle(e)
      },
    }),
    mutationCache: new MutationCache({
      onError: (e) => {
        handle(e)
      },
    }),
    defaultOptions: {
      queries: {
        // 4xx 는 재시도해도 같은 결과.
        retry: (count, e) =>
          count < 2 &&
          !(e instanceof ApiError && e.status >= 400 && e.status < 500),
      },
    },
  })
  function handle(e: unknown) {
    if (!isLogoutError(e)) return
    setSignedOut(qc)
    onLogout()
  }
  return qc
}

export function useLogout(): () => Promise<void> {
  const qc = useQueryClient()
  const { mutateAsync } = useMutation({
    mutationFn: () => call(api.POST('/api/auth/logout')),
    onSuccess: () => {
      setSignedOut(qc)
    },
  })
  return async () => {
    await mutateAsync()
  }
}
