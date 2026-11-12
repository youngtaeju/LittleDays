import { getRouteApi, Link } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '@/api/errors'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/i18n'
import { useUsers } from '@/members/useUsers'
import { useSettings } from '@/settings/useSettings'
import { Tile } from '@/timeline/Tile'
import { StoryBlock } from '@/stories/StoryBlock'
import { useTimeline } from '@/timeline/useTimeline'
import { MilestoneLine, uploaderNames, uploaderText } from './dayMeta'
import { Cell } from './Mosaic'
import { useDay } from './useDay'

const route = getRouteApi('/authed/shell/days/$date')

// 그날 화면. 머리글은 셸이 그림(DayHeader). 사진 그리드 다음 이야기들(전체 본문).
// 사진도 이야기도 없으면 마일스톤 한 줄.
export function DayPage() {
  const { t } = useTranslation()
  const { date } = route.useParams()
  const { baby } = route.useSearch()
  const timezone = useSettings()?.timezone
  const users = useUsers().data?.users
  const day = useDay(date, baby)
  // 사진 없는 날(글, 마일스톤만)은 사진 목록 요청 없음. 하루 응답 전엔 함께 요청.
  const media = day.data
    ? day.data.photo_count + day.data.video_count
    : undefined
  const hasMedia = media !== 0
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
  } = useTimeline(baby, { date, enabled: hasMedia })

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

  if (day.error instanceof ApiError && day.error.status === 404) {
    return (
      <div className="grid justify-items-center gap-3 py-16 text-center">
        <p className="text-base font-semibold">{t('day.empty')}</p>
        <Button asChild>
          <Link to="/" search={{ baby }}>
            {t('day.home')}
          </Link>
        </Button>
      </div>
    )
  }
  if (day.isError) {
    return (
      <div className="grid justify-items-start gap-3 py-4">
        <p className="text-sm">{errorMessage(t, day.error)}</p>
        <Button variant="outline" onClick={() => void day.refetch()}>
          {t('common.retry')}
        </Button>
      </div>
    )
  }
  if (!day.data) {
    return (
      <p className="py-4 text-sm text-muted-foreground">
        {t('common.loading')}
      </p>
    )
  }

  const { prev_date, next_date, stories } = day.data
  const uploader = uploaderText(t, uploaderNames(users, day.data.uploader_ids))
  return (
    <div>
      {uploader && (
        <p className="pb-3 text-sm text-muted-foreground">{uploader}</p>
      )}
      {hasMedia && status === 'pending' && (
        <p className="py-4 text-sm text-muted-foreground">
          {t('common.loading')}
        </p>
      )}
      {isLoadingError && (
        <div className="grid justify-items-start gap-3 py-4">
          <p className="text-sm">{errorMessage(t, error)}</p>
          <Button variant="outline" onClick={() => void refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      )}
      {/* 꺼진 쿼리도 이전 날 목록(placeholder)을 돌려줌. 사진 없는 날은 그리지 않음. */}
      <ul className="-mx-4 grid grid-cols-3 gap-[2px] sm:grid-cols-4 lg:grid-cols-6">
        {(hasMedia ? items : []).map((item) => (
          <Cell key={item.id} item={item}>
            <Tile item={item} baby={baby} timezone={timezone} />
          </Cell>
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
      {stories.length > 0 ? (
        <div className="grid gap-4 pt-4">
          {stories.map((story) => (
            <StoryBlock key={story.id} story={story} />
          ))}
        </div>
      ) : (
        !hasMedia && <MilestoneLine day={day.data} users={users} />
      )}
      {(prev_date || next_date) && (
        <nav
          aria-label={t('day.nav')}
          className="flex items-center justify-between gap-3 pt-6"
        >
          {prev_date && (
            <Button variant="outline" asChild>
              <Link
                to="/days/$date"
                params={{ date: prev_date }}
                search={{ baby }}
              >
                {t('day.prev')}
              </Link>
            </Button>
          )}
          {next_date && (
            <Button variant="outline" asChild className="ml-auto">
              <Link
                to="/days/$date"
                params={{ date: next_date }}
                search={{ baby }}
              >
                {t('day.next')}
              </Link>
            </Button>
          )}
        </nav>
      )}
    </div>
  )
}
