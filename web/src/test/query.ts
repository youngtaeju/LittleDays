import { QueryClient } from '@tanstack/react-query'
import { createQueryClient } from '@/auth/session'

// 컴포넌트 테스트 공용. 재시도 없음.
export function createTestQueryClient(): QueryClient {
  const client = createQueryClient(() => {})
  client.setDefaultOptions({
    queries: { ...client.getDefaultOptions().queries, retry: false },
    mutations: { ...client.getDefaultOptions().mutations, retry: false },
  })
  return client
}
