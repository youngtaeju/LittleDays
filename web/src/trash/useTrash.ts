import { useInfiniteQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { api, call } from '@/api/client'

export const trashKey = ['trash'] as const

export function useTrash() {
  const query = useInfiniteQuery({
    queryKey: trashKey,
    queryFn: ({ pageParam }) =>
      call(
        api.GET('/api/trash', {
          params: { query: { limit: 100, cursor: pageParam } },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.next_cursor ?? undefined,
  })
  const { data } = query
  const items = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data])
  return { ...query, items }
}
