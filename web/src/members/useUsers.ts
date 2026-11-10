import { useQuery } from '@tanstack/react-query'
import { api, call } from '@/api/client'

export const usersKey = ['users'] as const

// 모든 멤버 조회 가능. 가족 화면·피드 올린 사람 이름 공용.
export function useUsers() {
  return useQuery({
    queryKey: usersKey,
    queryFn: () => call(api.GET('/api/users')),
    // 홈 진입마다 재조회 방지. 역할 변경 등은 usersKey 무효화로 반영.
    staleTime: 60_000,
  })
}
