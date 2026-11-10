import { useQuery } from '@tanstack/react-query'
import { api, call } from '@/api/client'

// ['days'] 아래라 기존 무효화가 함께 갱신. 목록 쿼리(무한)와 모양이 달라 setQueriesData 는 무시.
export function dayKey(date: string, baby: string | undefined) {
  return ['days', 'detail', date, baby ?? null] as const
}

export function useDay(date: string, baby: string | undefined) {
  return useQuery({
    queryKey: dayKey(date, baby),
    queryFn: () =>
      call(
        api.GET('/api/days/{date}', {
          params: { path: { date }, query: { baby_id: baby } },
        }),
      ),
    staleTime: 60_000,
  })
}
