import { getRouteApi } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { DayFeed } from './DayFeed'
import { MemoryCard } from './MemoryCard'

const route = getRouteApi('/authed/shell/')

// 홈. 머리글(HomeHeader)은 셸이 그림(오프라인 배너 위).
export function FeedPage() {
  const { t } = useTranslation()
  const { baby } = route.useSearch()
  return (
    <div className="mx-auto max-w-[640px]">
      <h1 className="sr-only">{t('nav.home')}</h1>
      <MemoryCard baby={baby} />
      <DayFeed filter={{ baby }} />
    </div>
  )
}
