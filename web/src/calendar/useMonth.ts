import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api, call } from '@/api/client'
import { useToday } from '@/settings/useSettings'
import { addMonths, monthRange } from './month'

// ['days'] 접두라 자산, 이야기, 마일스톤 변경 무효화가 그대로 적용.
// 응답은 무한 목록 모양이 아니라 useTimeline 의 setQueriesData 는 무시.
function monthQuery(month: string, baby: string | undefined) {
  return queryOptions({
    queryKey: ['days', { month, baby }],
    queryFn: () =>
      call(
        api.GET('/api/days', {
          params: {
            query: { ...monthRange(month), limit: 31, baby_id: baby },
          },
        }),
      ),
    staleTime: 60_000,
  })
}

// 한 달 하루 목록. 이전 달과 (이번 달 이후가 아니면) 다음 달 미리 받기.
export function useMonth(month: string, baby: string | undefined) {
  const qc = useQueryClient()
  const thisMonth = useToday().slice(0, 7)
  const query = useQuery(monthQuery(month, baby))
  useEffect(() => {
    // 실패는 무시. 그 달로 가면 다시 요청.
    const prefetch = (m: string) => {
      qc.query(monthQuery(m, baby)).catch(() => undefined)
    }
    prefetch(addMonths(month, -1))
    const next = addMonths(month, 1)
    if (next <= thisMonth) prefetch(next)
  }, [qc, month, baby, thisMonth])
  return query
}
