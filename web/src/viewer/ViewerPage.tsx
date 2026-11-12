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
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api, call } from '@/api/client'
import { isLogoutError } from '@/api/errors'
import type { Asset, AssetSummary } from '@/api/types'
import { hasRole, useMe } from '@/auth/session'
import { CommentSheet, CommentThread } from '@/comments/Comments'
import { FormError } from '@/components/Field'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useFavorites } from '@/favorites/useFavorites'
import { ageParts } from '@/feed/dayMeta'
import { errorMessage } from '@/i18n'
import { useMediaQuery, WIDE } from '@/lib/useMediaQuery'
import { cn } from '@/lib/utils'
import { LikersSheet } from '@/reactions/LikersSheet'
import {
  favoritesKey,
  useToggleFavorite,
  useToggleLike,
} from '@/reactions/useReactions'
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

type Panel = 'info' | 'comments'

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

// 데스크톱 옆 패널 탭. 화살표 키는 뷰어 넘김에 양보해 둘 다 Tab 순서에 둠.
function PanelTab({
  id,
  panelId,
  selected,
  onSelect,
  children,
}: {
  id: string
  panelId: string
  selected: boolean
  onSelect: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      id={id}
      aria-selected={selected}
      aria-controls={selected ? panelId : undefined}
      className={cn(
        'h-full border-b-2 px-3 text-[15px] font-semibold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected
          ? 'border-accent-ink text-accent-ink'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
      onClick={onSelect}
    >
      {children}
    </button>
  )
}

export function ViewerPage() {
  const { t, i18n } = useTranslation()
  const { id } = route.useParams()
  const { baby, from } = route.useSearch()
  const fromFavorites = from === 'favorites'
  const navigate = useNavigate()
  const router = useRouter()
  const canGoBack = useCanGoBack()
  const qc = useQueryClient()
  const canEdit = hasRole(useMe().user, 'guardian')
  const tz = useSettings()?.timezone
  const babies = useBabies().data
  const wide = useMediaQuery(WIDE)

  const asset = useAsset(id)
  const timeline = useTimeline(baby, {
    refetchOnMount: false,
    enabled: !fromFavorites,
  })
  const favorites = useFavorites({
    refetchOnMount: false,
    enabled: fromFavorites,
  })
  const {
    items,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
  } = fromFavorites ? favorites : timeline
  const ids = useMemo(() => items.map((i) => i.id), [items])
  const listed = ids.includes(id)
  const found = neighbors(ids, id)
  // ★ 를 꺼 즐겨찾기 목록에서 빠져도 열린 사진은 마지막으로 목록에 있던 때의 이웃 유지.
  const [kept, setKept] = useState<{
    id: string
    prev?: string
    next?: string
  } | null>(null)
  if (
    fromFavorites &&
    listed &&
    (kept?.id !== id || kept.prev !== found.prev || kept.next !== found.next)
  ) {
    setKept({ id, ...found })
  }
  const { prev, next } =
    fromFavorites && !listed && kept?.id === id ? kept : found
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

  // 정보/댓글 패널은 넘겨도 같은 탭 유지(데스크톱 옆 패널). 확대, 편집, 휴지통 확인은 항목마다 초기화.
  const [shownId, setShownId] = useState(id)
  const [panel, setPanel] = useState<Panel | null>(null)
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

  const like = useToggleLike({ kind: 'asset', id })
  const favorite = useToggleFavorite(id, { fromFavorites })

  // 불러온 목록의 마지막 항목이거나 아직 목록에 없으면 다음 페이지. 실패·끝이면 중단.
  // 상세 도착 후 판단. 휴지통·다른 아기·이미 지나친 시각처럼 목록에 나올 수 없으면 순회 안 함.
  // 즐겨찾기 목록은 즐겨찾기한 시각 순서라 즐겨찾기 여부와 휴지통만 판단.
  const unlisted =
    !listed &&
    detail !== undefined &&
    (fromFavorites
      ? detail.favorited && detail.deleted_at === null
      : !outsideTimeline(detail, items[items.length - 1], baby))
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
      search: { baby, from },
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
        // 직접 진입(앱 내 이전 기록 없음)이면 타임라인 또는 즐겨찾기 화면.
        if (canGoBack) router.history.back()
        else if (fromFavorites) void navigate({ to: '/me/favorites' })
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
      // 휴지통 사진은 즐겨찾기 목록에서 빠짐. 이동과 복구 모두 다시 조회.
      void qc.invalidateQueries({ queryKey: favoritesKey })
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
      void qc.invalidateQueries({ queryKey: favoritesKey })
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

  // 휴지통 사진은 반응 404. 처리 실패 사진은 같은 파일 재업로드 시 휴지통 없이 지워져 반응도 유실.
  const reactable =
    detail && !detail.deleted_at && detail.status !== 'failed' ? detail : null
  // 반응 없는 사진이면 데스크톱은 정보 탭, 휴대폰은 시트 없음. 상태는 유지해 다음 사진에서 다시 댓글.
  const shown: Panel | null =
    panel === 'comments' && !reactable ? (wide ? 'info' : null) : panel
  const tabsId = useId()

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

  const infoPanel = detail && (
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
                  open: shown === 'info',
                  onToggle: () => {
                    setPanel(shown === 'info' ? null : 'info')
                  },
                }
              : null
          }
          onEditTakenAt={
            canEdit && tz && detail
              ? () => {
                  setPanel('info')
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
          reactions={
            reactable
              ? {
                  liked: reactable.liked,
                  likeCount: reactable.like_count,
                  favorited: reactable.favorited,
                  onLike: () => {
                    like.mutate(!reactable.liked)
                  },
                  onLikers: () => {
                    setLikersOpen(true)
                  },
                  onFavorite: () => {
                    const next = !reactable.favorited
                    favorite.mutate(next)
                    if (next)
                      toast(t('reactions.favorited'), { duration: 2000 })
                  },
                  comments: {
                    count: reactable.comment_count,
                    open: shown === 'comments',
                    // 데스크톱은 탭 전환 겸 닫기, 휴대폰은 시트 열기.
                    onOpen: () => {
                      setPanel(wide && shown === 'comments' ? null : 'comments')
                    },
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
        shown &&
        infoPanel && (
          <aside
            aria-label={
              shown === 'info' ? t('viewer.info') : t('comments.label')
            }
            className="flex w-[360px] shrink-0 flex-col border-l bg-background text-foreground"
          >
            <div className="flex h-14 shrink-0 items-center justify-between pr-2 pl-2">
              <div
                role="tablist"
                aria-label={t('viewer.panelTabs')}
                className="flex h-full"
              >
                <PanelTab
                  id={`${tabsId}-info`}
                  panelId={`${tabsId}-panel`}
                  selected={shown === 'info'}
                  onSelect={() => {
                    setPanel('info')
                  }}
                >
                  {t('viewer.info')}
                </PanelTab>
                {reactable && (
                  <PanelTab
                    id={`${tabsId}-comments`}
                    panelId={`${tabsId}-panel`}
                    selected={shown === 'comments'}
                    onSelect={() => {
                      setPanel('comments')
                    }}
                  >
                    {t('comments.title', { count: reactable.comment_count })}
                  </PanelTab>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={
                  shown === 'info' ? t('viewer.closeInfo') : t('comments.close')
                }
                onClick={() => {
                  setPanel(null)
                }}
              >
                <IconClose className="size-6" />
              </Button>
            </div>
            <div
              role="tabpanel"
              id={`${tabsId}-panel`}
              aria-labelledby={`${tabsId}-${shown}`}
              className={cn(
                'min-h-0 flex-1',
                shown === 'info' ? 'overflow-y-auto' : 'flex flex-col',
              )}
            >
              {shown === 'info' ? (
                infoPanel
              ) : (
                <CommentThread key={id} target={{ kind: 'asset', id }} />
              )}
            </div>
          </aside>
        )
      ) : (
        <>
          <Sheet
            open={shown === 'info' && !!infoPanel}
            onOpenChange={(open) => {
              setPanel(open ? 'info' : null)
            }}
          >
            <SheetContent
              side="bottom"
              aria-describedby={undefined}
              className="dark max-h-[85dvh] overflow-y-auto text-foreground"
            >
              <SheetHeader>
                <SheetTitle>{t('viewer.info')}</SheetTitle>
              </SheetHeader>
              {infoPanel}
            </SheetContent>
          </Sheet>
          {reactable && (
            <CommentSheet
              target={{ kind: 'asset', id }}
              open={shown === 'comments'}
              onOpenChange={(open) => {
                setPanel(open ? 'comments' : null)
              }}
              count={reactable.comment_count}
              likeCount={reactable.like_count}
            />
          )}
        </>
      )}
      <LikersSheet
        target={{ kind: 'asset', id }}
        open={likersOpen}
        onOpenChange={setLikersOpen}
      />
    </div>
  )
}
