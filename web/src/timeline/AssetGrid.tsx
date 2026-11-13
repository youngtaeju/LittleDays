import { useEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { AssetSummary } from '@/api/types'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/i18n'
import { Tile, type TileFrom } from './Tile'

// 정사각 타일 격자 + 무한 스크롤. 즐겨찾기, 영상, 앨범 화면 공용.
// linkSearch: 타일의 뷰어 search(이전/다음 기준 목록). empty: 항목 없을 때 문구.
export function AssetGrid({
  items,
  timezone,
  linkSearch,
  empty,
  status,
  error,
  isLoadingError,
  refetch,
  hasNextPage,
  fetchNextPage,
  isFetchingNextPage,
  isFetchNextPageError,
}: {
  items: AssetSummary[]
  timezone: string | undefined
  linkSearch: { from: TileFrom; of?: string }
  empty: ReactNode
  status: 'pending' | 'error' | 'success'
  error: unknown
  isLoadingError: boolean
  refetch: () => Promise<unknown>
  hasNextPage: boolean
  fetchNextPage: () => Promise<unknown>
  isFetchingNextPage: boolean
  isFetchNextPageError: boolean
}) {
  const { t } = useTranslation()

  // 화면 끝 1000px 전부터 다음 페이지. 실패 시 자동 재시도 대신 버튼.
  const sentinel = useRef<HTMLDivElement>(null)
  const autoLoad = hasNextPage && !isFetchingNextPage && !isFetchNextPageError
  useEffect(() => {
    const el = sentinel.current
    if (!el || !autoLoad) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void fetchNextPage()
      },
      { rootMargin: '1000px 0px' },
    )
    io.observe(el)
    return () => {
      io.disconnect()
    }
  }, [autoLoad, fetchNextPage])

  return (
    <>
      {status === 'pending' && (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      )}
      {isLoadingError && (
        <div className="grid justify-items-start gap-3">
          <p className="text-sm">{errorMessage(t, error)}</p>
          <Button variant="outline" onClick={() => void refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      )}
      {status === 'success' && items.length === 0 && (
        <p className="py-16 text-center text-base">{empty}</p>
      )}
      <ul className="-mx-4 grid grid-cols-3 gap-[2px] sm:mx-0 sm:grid-cols-4 lg:grid-cols-6">
        {items.map((item) => (
          <li key={item.id}>
            <Tile
              item={item}
              timezone={timezone}
              from={linkSearch.from}
              of={linkSearch.of}
            />
          </li>
        ))}
      </ul>
      <div ref={sentinel} />
      {isFetchingNextPage && (
        <p className="py-4 text-center text-sm text-muted-foreground">
          {t('common.loading')}
        </p>
      )}
      {isFetchNextPageError && (
        <div className="grid justify-items-center gap-3 py-4">
          <p className="text-sm">{errorMessage(t, error)}</p>
          <Button variant="outline" onClick={() => void fetchNextPage()}>
            {t('common.retry')}
          </Button>
        </div>
      )}
    </>
  )
}
