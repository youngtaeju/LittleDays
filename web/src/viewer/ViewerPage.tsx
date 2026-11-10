import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getRouteApi,
  useCanGoBack,
  useNavigate,
  useRouter,
} from '@tanstack/react-router'
import IconChevronLeft from '~icons/material-symbols/chevron-left-rounded'
import IconChevronRight from '~icons/material-symbols/chevron-right-rounded'
import IconClose from '~icons/material-symbols/close-rounded'
import IconInfo from '~icons/material-symbols/info-outline-rounded'
import IconProgress from '~icons/material-symbols/progress-activity-rounded'
import IconWarning from '~icons/material-symbols/warning-outline-rounded'
import IconZoomIn from '~icons/material-symbols/zoom-in-rounded'
import IconZoomOut from '~icons/material-symbols/zoom-out-rounded'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api, call } from '@/api/client'
import { isLogoutError } from '@/api/errors'
import type { Asset, AssetSummary } from '@/api/types'
import { hasRole, useMe } from '@/auth/session'
import { FormError } from '@/components/Field'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { errorMessage } from '@/i18n'
import { cn } from '@/lib/utils'
import { Blurhash } from '@/timeline/Blurhash'
import { largeUrl, previewSources, thumbUrl, videoUrl } from '@/timeline/media'
import { babiesKey } from '@/timeline/useBabies'
import { assetKey, useTimeline } from '@/timeline/useTimeline'
import { InfoPanel } from './InfoPanel'
import { neighbors } from './neighbors'
import { applyAsset, useAsset } from './useAsset'
import { useSwipe } from './useSwipe'

const route = getRouteApi('/authed/photos/$id')

const FADE_MS = 150

function ProcessingView({ media }: { media: Asset | AssetSummary }) {
  const { t } = useTranslation()
  const ratio = media.width && media.height ? media.width / media.height : 1
  return (
    <div className="absolute inset-0 flex items-center justify-center p-8">
      <div
        className="relative grid max-h-full w-full max-w-sm place-items-center overflow-hidden"
        style={{
          aspectRatio: ratio,
          backgroundColor: media.dominant_color ?? undefined,
        }}
      >
        {media.blurhash && (
          <Blurhash
            hash={media.blurhash}
            className="absolute inset-0 size-full"
          />
        )}
        <p className="relative flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-sm">
          <IconProgress
            aria-hidden
            className="size-4 animate-spin motion-reduce:animate-none"
          />
          {t('timeline.processing')}
        </p>
      </div>
    </div>
  )
}

function FailedView({
  error,
  onRetry,
  retrying,
  retryError,
}: {
  error: string | null
  onRetry?: () => void
  retrying: boolean
  retryError: unknown
}) {
  const { t } = useTranslation()
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8 text-center">
      <IconWarning aria-hidden className="size-8 text-muted-foreground" />
      <p>{t('viewer.failed')}</p>
      {/* 서버 원문. 언어 혼재 가능. */}
      {error && (
        <p className="max-w-md text-sm break-words text-muted-foreground">
          {error}
        </p>
      )}
      {onRetry && (
        <Button variant="outline" disabled={retrying} onClick={onRetry}>
          {t('viewer.retry')}
        </Button>
      )}
      <FormError error={retryError} />
    </div>
  )
}

export function ViewerPage() {
  const { t } = useTranslation()
  const { id } = route.useParams()
  const { baby } = route.useSearch()
  const navigate = useNavigate()
  const router = useRouter()
  const canGoBack = useCanGoBack()
  const qc = useQueryClient()
  const canEdit = hasRole(useMe().user, 'guardian')

  const asset = useAsset(id)
  const {
    items,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
  } = useTimeline(baby, { refetchOnMount: false })
  const ids = useMemo(() => items.map((i) => i.id), [items])
  const { prev, next } = neighbors(ids, id)
  // 상세 도착 전엔 목록 항목으로 표시. 넘길 때 빈 화면 방지.
  const media = asset.data ?? items.find((i) => i.id === id)

  // 항목이 바뀌면 확대·정보 시트 초기화.
  const [shownId, setShownId] = useState(id)
  const [zoomed, setZoomed] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  if (shownId !== id) {
    setShownId(id)
    setZoomed(false)
    setInfoOpen(false)
  }

  // 불러온 목록의 마지막 항목이면 다음 페이지. 실패 시 반복 요청 없음.
  const atEnd = ids.length > 0 && ids[ids.length - 1] === id
  useEffect(() => {
    if (atEnd && hasNextPage && !isFetchingNextPage && !isFetchNextPageError) {
      void fetchNextPage()
    }
  }, [
    atEnd,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
  ])

  // 이전/다음은 기록 교체. 닫으면 뷰어 진입 전 위치로.
  function go(target: string | undefined) {
    if (!target) return
    void navigate({
      to: '/photos/$id',
      params: { id: target },
      search: { baby },
      replace: true,
    })
  }

  const [closing, setClosing] = useState(false)
  const closeTimer = useRef<number | undefined>(undefined)
  useEffect(
    () => () => {
      window.clearTimeout(closeTimer.current)
    },
    [],
  )
  function close() {
    if (closing) return
    setClosing(true)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    closeTimer.current = window.setTimeout(
      () => {
        // 직접 진입(앱 내 이전 기록 없음)이면 타임라인.
        if (canGoBack) router.history.back()
        else void navigate({ to: '/', search: { baby } })
      },
      reduce ? 0 : FADE_MS,
    )
  }

  const restore = useMutation({
    mutationFn: (assetId: string) =>
      call(
        api.POST('/api/assets/{id}/restore', {
          params: { path: { id: assetId } },
        }),
      ),
    onSuccess: (a) => {
      applyAsset(qc, a)
      toast(t('viewer.restored'))
    },
    onError: (e) => {
      if (!isLogoutError(e)) toast.error(errorMessage(t, e))
    },
  })

  const trash = useMutation({
    mutationFn: (assetId: string) =>
      call(
        api.DELETE('/api/assets/{id}', { params: { path: { id: assetId } } }),
      ),
    onSuccess: (_, assetId) => {
      void qc.invalidateQueries({ queryKey: ['assets'] })
      // 떠나는 항목이라 즉시 재조회 안 함.
      void qc.invalidateQueries({
        queryKey: assetKey(assetId),
        refetchType: 'none',
      })
      // 서버가 대표사진 지정 해제.
      void qc.invalidateQueries({ queryKey: babiesKey })
      toast(t('viewer.trashed'), {
        action: {
          label: t('viewer.undo'),
          onClick: () => {
            restore.mutate(assetId)
          },
        },
      })
      if (next) go(next)
      else close()
    },
  })

  const retry = useMutation({
    mutationFn: (assetId: string) =>
      call(
        api.POST('/api/assets/{id}/retry', {
          params: { path: { id: assetId } },
        }),
      ),
    onSuccess: (a) => {
      applyAsset(qc, a)
    },
  })

  const swipe = useSwipe({
    enabled: !zoomed,
    onLeft: () => {
      go(next)
    },
    onRight: () => {
      go(prev)
    },
  })

  // 입력·시트·대화상자 안의 키는 무시. 영상 포커스 중 화살표는 탐색용.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return
      const el = e.target instanceof Element ? e.target : null
      if (el?.closest('[role="dialog"], input, textarea, select')) return
      if (e.key === 'Escape') close()
      else if (el instanceof HTMLVideoElement) return
      else if (e.key === 'ArrowLeft') go(prev)
      else if (e.key === 'ArrowRight') go(next)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  })

  const detail = asset.data
  const ready = media?.status === 'ready'
  const canZoom = ready && media.kind === 'photo' && !!media.derivatives.large
  const label =
    detail?.caption ||
    (media?.kind === 'video' ? t('timeline.video') : t('timeline.photo'))

  let content
  if (!media) {
    content = (
      <p className="absolute inset-0 flex items-center justify-center p-8 text-center text-sm">
        {asset.isError ? errorMessage(t, asset.error) : t('common.loading')}
      </p>
    )
  } else if (media.status === 'processing') {
    content = <ProcessingView media={media} />
  } else if (media.status === 'failed') {
    content = (
      <FailedView
        error={detail?.processing_error ?? null}
        {...(canEdit && {
          onRetry: () => {
            retry.mutate(media.id)
          },
        })}
        retrying={retry.isPending}
        // 다른 항목의 이전 실패는 표시 안 함.
        retryError={retry.variables === media.id ? retry.error : null}
      />
    )
  } else if (media.kind === 'video') {
    content = (
      <video
        key={media.id}
        controls
        playsInline
        aria-label={label}
        poster={previewSources(media).webp}
        src={videoUrl(media.id)}
        className="absolute inset-0 size-full"
      />
    )
  } else if (zoomed) {
    content = (
      <div className="absolute inset-0 flex overflow-auto">
        <img
          src={largeUrl(media.id)}
          alt={label}
          draggable={false}
          className="m-auto max-w-none"
        />
      </div>
    )
  } else {
    const src = previewSources(media)
    content = (
      <picture>
        {src.avif && <source type="image/avif" srcSet={src.avif} />}
        <img
          src={src.webp ?? thumbUrl(media.id)}
          alt={label}
          draggable={false}
          className="absolute inset-0 size-full object-contain"
        />
      </picture>
    )
  }

  // 모든 폭에서 표시(영상은 스와이프 제외라 버튼이 유일한 터치 이동 수단).
  // 640px 미만: 상단 바의 닫기 옆, 작게. 영상 컨트롤·가운데 재생 버튼과 겹침 방지.
  // 640px 이상: 화면 좌우 가운데.
  const navButton =
    'absolute top-2.5 text-white sm:top-1/2 sm:size-10 sm:-translate-y-1/2 sm:rounded-full sm:bg-black/40 sm:hover:bg-black/60'

  return (
    <div
      className={cn(
        'dark fixed inset-0 flex flex-col bg-black text-white transition-opacity duration-150 starting:opacity-0',
        closing && 'opacity-0',
      )}
    >
      <div className="flex h-14 shrink-0 items-center gap-1 px-2">
        {/* 진입 시 포커스를 뷰어 안으로. */}
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('common.close')}
          onClick={close}
          autoFocus
        >
          <IconClose />
        </Button>
        <div className="flex-1" />
        {canZoom && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={zoomed ? t('viewer.zoomOut') : t('viewer.zoomIn')}
            onClick={() => {
              setZoomed((z) => !z)
            }}
          >
            {zoomed ? <IconZoomOut /> : <IconZoomIn />}
          </Button>
        )}
        {detail && (
          <Sheet open={infoOpen} onOpenChange={setInfoOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={t('viewer.info')}>
                <IconInfo />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="bottom"
              aria-describedby={undefined}
              className="dark max-h-[85dvh] overflow-y-auto text-foreground"
            >
              <SheetHeader>
                <SheetTitle>{t('viewer.info')}</SheetTitle>
              </SheetHeader>
              <InfoPanel
                asset={detail}
                canEdit={canEdit}
                onTrash={() => {
                  trash.mutate(detail.id)
                }}
                trashing={trash.isPending}
                trashError={trash.variables === detail.id ? trash.error : null}
              />
            </SheetContent>
          </Sheet>
        )}
      </div>
      <main
        {...swipe}
        className={cn(
          'relative min-h-0 flex-1',
          !zoomed && 'touch-pan-y touch-pinch-zoom',
        )}
      >
        {content}
      </main>
      {prev && (
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('viewer.prev')}
          className={cn(navButton, 'left-12 sm:left-2')}
          onClick={() => {
            go(prev)
          }}
        >
          <IconChevronLeft />
        </Button>
      )}
      {next && (
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('viewer.next')}
          className={cn(navButton, 'left-22 sm:right-2 sm:left-auto')}
          onClick={() => {
            go(next)
          }}
        >
          <IconChevronRight />
        </Button>
      )}
    </div>
  )
}
