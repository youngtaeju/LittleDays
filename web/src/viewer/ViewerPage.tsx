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
import IconProgress from '~icons/material-symbols/progress-activity-rounded'
import IconWarning from '~icons/material-symbols/warning-outline-rounded'
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
} from '@/components/ui/sheet'
import { ageParts } from '@/feed/dayMeta'
import { errorMessage } from '@/i18n'
import { useMediaQuery, WIDE } from '@/lib/useMediaQuery'
import { cn } from '@/lib/utils'
import { LikersSheet } from '@/reactions/LikersSheet'
import { useToggleFavorite, useToggleLike } from '@/reactions/useReactions'
import { useSettings } from '@/settings/useSettings'
import { Blurhash } from '@/timeline/Blurhash'
import {
  largeUrl,
  originalUrl,
  previewSources,
  thumbUrl,
  videoUrl,
} from '@/timeline/media'
import { babiesKey, useBabies } from '@/timeline/useBabies'
import { assetKey, useTimeline } from '@/timeline/useTimeline'
import { InfoPanel, type Editing } from './InfoPanel'
import { neighbors, outsideTimeline } from './neighbors'
import { applyAsset, useAsset } from './useAsset'
import { useDismissDrag } from './useDismissDrag'
import { useSwipe } from './useSwipe'
import { useZoom } from './useZoom'
import { VideoPlayer } from './VideoPlayer'
import { ViewerBars } from './ViewerBars'
import { formatMoment, todayInZone } from './zoned'

const route = getRouteApi('/authed/photos/$id')

const FADE_MS = 200
// 이만큼 끌면 바탕이 가장 옅어짐.
const DRAG_FADE_PX = 400

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
  onRetry: (() => void) | undefined
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
  const { t, i18n } = useTranslation()
  const { id } = route.useParams()
  const { baby } = route.useSearch()
  const navigate = useNavigate()
  const router = useRouter()
  const canGoBack = useCanGoBack()
  const qc = useQueryClient()
  const canEdit = hasRole(useMe().user, 'guardian')
  const tz = useSettings()?.timezone
  const babies = useBabies().data
  const wide = useMediaQuery(WIDE)

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
  const detail = asset.data
  const canZoom = media?.status === 'ready' && media.kind === 'photo'

  const stage = useRef<HTMLElement>(null)
  const [barsVisible, setBarsVisible] = useState(true)
  const preview = media?.derivatives.preview
  const zoom = useZoom(stage, {
    enabled: canZoom,
    aspect: preview
      ? preview.width / preview.height
      : media?.width && media.height
        ? media.width / media.height
        : undefined,
    onTap: () => {
      setBarsVisible((v) => !v)
    },
  })

  // 정보 패널은 넘겨도 유지(데스크톱 옆 패널). 확대·편집·휴지통 확인은 항목마다 초기화.
  const [shownId, setShownId] = useState(id)
  const [infoOpen, setInfoOpen] = useState(false)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [trashOpen, setTrashOpen] = useState(false)
  const [likersOpen, setLikersOpen] = useState(false)
  const [scrubbing, setScrubbing] = useState(false)
  if (shownId !== id) {
    setShownId(id)
    zoom.reset()
    setEditing(null)
    setTrashOpen(false)
    setLikersOpen(false)
  }

  const like = useToggleLike(id)
  const favorite = useToggleFavorite(id)

  // 불러온 목록의 마지막 항목이거나 아직 목록에 없으면 다음 페이지. 실패·끝이면 중단.
  // 상세 도착 후 판단. 휴지통·다른 아기·이미 지나친 시각처럼 목록에 나올 수 없으면 순회 안 함.
  const unlisted =
    !ids.includes(id) &&
    detail !== undefined &&
    !outsideTimeline(detail, items[items.length - 1], baby)
  const atEnd = ids.length > 0 && (ids[ids.length - 1] === id || unlisted)
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

  const drag = useDismissDrag(stage, {
    enabled: !!media && !zoom.isZoomed && !closing && !scrubbing,
    onDismiss: close,
  })

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
      void qc.invalidateQueries({ queryKey: ['days'] })
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
      else {
        setTrashOpen(false)
        close()
      }
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
  const retryProps = {
    onRetry:
      canEdit && media
        ? () => {
            retry.mutate(media.id)
          }
        : undefined,
    retrying: retry.isPending,
    // 다른 항목의 이전 실패는 표시 안 함.
    retryError: media && retry.variables === media.id ? retry.error : null,
  }

  const swipe = useSwipe({
    enabled: !zoom.isZoomed && !scrubbing,
    onLeft: () => {
      go(next)
    },
    onRight: () => {
      go(prev)
    },
  })

  // 입력·시트·대화상자·메뉴 안의 키는 무시. 영상 포커스 중 화살표는 탐색용.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return
      const el = e.target instanceof Element ? e.target : null
      if (el?.closest('[role="dialog"], [role="menu"]')) return
      // 재생 위치 막대는 글자 입력이 아니라 Esc 로 닫기 허용.
      const typing = el?.closest('input:not([type="range"]), textarea, select')
      if (typing) return
      if (e.key === 'Escape') close()
      else if (el?.closest('input')) return
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
      <FailedView error={detail?.processing_error ?? null} {...retryProps} />
    )
  } else if (media.kind === 'video') {
    content = (
      <VideoPlayer
        key={media.id}
        label={label}
        poster={previewSources(media).webp}
        src={videoUrl(media.id)}
        durationHint={media.duration_ms ? media.duration_ms / 1000 : 0}
        controlsVisible={barsVisible}
        onScrubbingChange={setScrubbing}
      />
    )
  } else {
    const src = previewSources(media)
    content = (
      // 항목마다 새 요소. 이전 사진의 확대 해제가 전환 효과로 보이지 않게.
      <div
        key={media.id}
        className={cn(
          'absolute inset-0',
          !zoom.gesturing && 'transition-transform',
        )}
        style={{
          transform: `translate(${String(zoom.tx)}px, ${String(zoom.ty)}px) scale(${String(zoom.scale)})`,
        }}
      >
        <picture>
          {src.avif && <source type="image/avif" srcSet={src.avif} />}
          <img
            src={src.webp ?? thumbUrl(media.id)}
            alt={label}
            draggable={false}
            className="absolute inset-0 size-full object-contain"
          />
        </picture>
        {/* 확대 중엔 큰 파생물을 위에 겹침. 불러오는 동안 미리보기 유지. */}
        {zoom.isZoomed && media.derivatives.large && (
          <img
            src={largeUrl(media.id)}
            alt=""
            draggable={false}
            className="absolute inset-0 size-full object-contain"
          />
        )}
      </div>
    )
  }

  const panel = detail && (
    <InfoPanel
      asset={detail}
      canEdit={canEdit}
      editing={editing}
      onEditingChange={setEditing}
      {...retryProps}
    />
  )

  const localDate = media && tz && todayInZone(tz, new Date(media.taken_at))
  const age =
    media && localDate && babies
      ? ageParts(t, { date: localDate, baby_ids: media.baby_ids }, babies, baby)
          .map((a) => a.text)
          .join(' · ')
      : ''

  // 끌어 내리는 동안 바탕이 옅어짐.
  const backdrop = 1 - Math.min(drag.offset / DRAG_FADE_PX, 0.7)
  const navButton = cn(
    'absolute top-1/2 z-10 size-11 -translate-y-1/2 rounded-full bg-black/50 text-white transition-opacity duration-200 hover:bg-black/70',
    !barsVisible && 'opacity-0',
  )
  const showBars = barsVisible && drag.offset === 0

  return (
    <div
      className={cn(
        'dark fixed inset-0 flex text-white transition-opacity starting:opacity-0',
        closing && 'opacity-0',
      )}
      style={{ backgroundColor: `rgb(0 0 0 / ${String(backdrop)})` }}
    >
      <div className="relative min-w-0 flex-1 overflow-hidden">
        <main
          ref={stage}
          {...swipe}
          className={cn(
            'absolute inset-0 touch-none select-none',
            !drag.dragging && 'transition-transform',
          )}
          style={
            drag.offset > 0
              ? { transform: `translateY(${String(drag.offset)}px)` }
              : undefined
          }
        >
          {content}
        </main>
        <ViewerBars
          visible={showBars}
          title={
            media && tz
              ? formatMoment(media.taken_at, tz, i18n.language, {
                  am: t('viewer.am'),
                  pm: t('viewer.pm'),
                })
              : null
          }
          age={age}
          onClose={close}
          zoom={
            canZoom ? { zoomed: zoom.isZoomed, onToggle: zoom.toggle } : null
          }
          download={{
            href: originalUrl(id),
            filename: detail?.original_filename,
          }}
          info={
            detail
              ? {
                  open: infoOpen,
                  onToggle: () => {
                    setInfoOpen((o) => !o)
                  },
                }
              : null
          }
          onEditTakenAt={
            canEdit && tz && detail
              ? () => {
                  setInfoOpen(true)
                  setEditing('takenAt')
                }
              : null
          }
          trash={
            canEdit && media
              ? {
                  open: trashOpen,
                  onOpenChange: setTrashOpen,
                  onConfirm: () => {
                    trash.mutate(media.id)
                  },
                  pending: trash.isPending,
                  error: trash.variables === media.id ? trash.error : null,
                }
              : null
          }
          // 휴지통 사진은 반응 404. 처리 실패 사진은 같은 파일 재업로드 시 휴지통 없이 지워져 반응도 유실.
          reactions={
            detail && !detail.deleted_at && detail.status !== 'failed'
              ? {
                  liked: detail.liked,
                  likeCount: detail.like_count,
                  favorited: detail.favorited,
                  onLike: () => {
                    like.mutate(!detail.liked)
                  },
                  onLikers: () => {
                    setLikersOpen(true)
                  },
                  onFavorite: () => {
                    const next = !detail.favorited
                    favorite.mutate(next)
                    if (next)
                      toast(t('reactions.favorited'), { duration: 2000 })
                  },
                }
              : null
          }
        />
        {/* 막대와 함께 숨김. */}
        {prev && (
          <Button
            variant="ghost"
            size="icon"
            inert={!showBars}
            aria-label={t('viewer.prev')}
            className={cn(navButton, 'left-2')}
            onClick={() => {
              go(prev)
            }}
          >
            <IconChevronLeft className="size-6" />
          </Button>
        )}
        {next && (
          <Button
            variant="ghost"
            size="icon"
            inert={!showBars}
            aria-label={t('viewer.next')}
            className={cn(navButton, 'right-2')}
            onClick={() => {
              go(next)
            }}
          >
            <IconChevronRight className="size-6" />
          </Button>
        )}
      </div>
      {wide ? (
        infoOpen &&
        panel && (
          <aside
            aria-label={t('viewer.info')}
            className="w-[360px] shrink-0 overflow-y-auto border-l bg-background text-foreground"
          >
            <div className="flex h-14 items-center justify-between pr-2 pl-4">
              <h2 className="text-base font-semibold">{t('viewer.info')}</h2>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('viewer.closeInfo')}
                onClick={() => {
                  setInfoOpen(false)
                }}
              >
                <IconClose className="size-6" />
              </Button>
            </div>
            {panel}
          </aside>
        )
      ) : (
        <Sheet open={infoOpen && !!panel} onOpenChange={setInfoOpen}>
          <SheetContent
            side="bottom"
            aria-describedby={undefined}
            className="dark max-h-[85dvh] overflow-y-auto text-foreground"
          >
            <SheetHeader>
              <SheetTitle>{t('viewer.info')}</SheetTitle>
            </SheetHeader>
            {panel}
          </SheetContent>
        </Sheet>
      )}
      <LikersSheet
        assetId={id}
        open={likersOpen}
        onOpenChange={setLikersOpen}
      />
    </div>
  )
}
