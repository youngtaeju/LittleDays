import {
  MutationCache,
  QueryCache,
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { api, call } from '@/api/client'
import { ApiError, isLogoutError } from '@/api/errors'
import type { User } from '@/api/types'

export const meQueryKey = ['me'] as const

export function useMe(): { user: User | null; isLoading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: meQueryKey,
    queryFn: async (): Promise<User | null> => {
      try {
        return (await call(api.GET('/api/auth/me'))).user
      } catch (e) {
        // 비로그인 상태는 에러가 아님.
        if (e instanceof ApiError && e.status === 401) return null
        throw e
      }
    },
  })
  return { user: data ?? null, isLoading }
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
    qc.setQueryData(meQueryKey, null)
    onLogout()
  }
  return qc
}

export function useLogout(): () => Promise<void> {
  const qc = useQueryClient()
  const { mutateAsync } = useMutation({
    mutationFn: () => call(api.POST('/api/auth/logout')),
    onSuccess: () => {
      qc.clear()
      qc.setQueryData(meQueryKey, null)
    },
  })
  return async () => {
    await mutateAsync()
  }
}
