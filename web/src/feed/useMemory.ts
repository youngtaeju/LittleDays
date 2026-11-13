import { useQuery } from '@tanstack/react-query'
import { api, call } from '@/api/client'
import { useToday } from '@/settings/useSettings'

// ['days'] 접두라 사진, 이야기 변경 무효화로 갱신. 응답이 무한 목록 모양이 아니라 대표 사진 갱신은 무시.
// today 는 날이 바뀌면 다시 받는 용도. 서버가 인스턴스 시간대로 오늘을 정함.
export function useMemory(baby: string | undefined) {
  const today = useToday()
  return useQuery({
    queryKey: ['days', 'memory', { baby, today }],
    queryFn: () =>
      call(
        api.GET('/api/memories', {
          params: { query: { baby_id: baby } },
        }),
      ),
    staleTime: 60_000,
  })
}
