import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/i18n'
import { MeSubPage } from '@/me/MeSubPage'
import { useSettings } from '@/settings/useSettings'
import { Tile } from '@/timeline/Tile'
import { useFavorites } from './useFavorites'

export function FavoritesPage() {
  const { t } = useTranslation()
  const timezone = useSettings()?.timezone
  const {
    items,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    isLoadingError,
    status,
    error,
    refetch,
  } = useFavorites()

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
    <MeSubPage title={t('nav.favorites')}>
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
        <p className="py-16 text-center text-base">{t('favorites.empty')}</p>
      )}
      <ul className="-mx-4 grid grid-cols-3 gap-[2px] sm:mx-0 sm:grid-cols-4 lg:grid-cols-6">
        {items.map((item) => (
          <li key={item.id}>
            <Tile item={item} timezone={timezone} from="favorites" />
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
    </MeSubPage>
  )
}
