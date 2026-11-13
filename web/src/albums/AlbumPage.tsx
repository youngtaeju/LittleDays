import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getRouteApi,
  useCanGoBack,
  useNavigate,
  useRouter,
} from '@tanstack/react-router'
import IconAdd from '~icons/material-symbols/add-rounded'
import IconMore from '~icons/material-symbols/more-vert-rounded'
import type { TFunction } from 'i18next'
import { DropdownMenu } from 'radix-ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api, call } from '@/api/client'
import { ApiError, isLogoutError } from '@/api/errors'
import type { AlbumSummary } from '@/api/types'
import { hasRole, useMe } from '@/auth/session'
import { FormError } from '@/components/Field'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { errorMessage } from '@/i18n'
import { formatDate, formatMonthDay } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { MeSubPage } from '@/me/MeSubPage'
import { useBrowserOnline } from '@/pwa/OfflineBanner'
import { useSettings } from '@/settings/useSettings'
import { AssetGrid } from '@/timeline/AssetGrid'
import { AddPhotosSheet } from './AddPhotosSheet'
import { AlbumNameDialog } from './AlbumNameDialog'
import { albumKey, useAlbum, useAlbumAssets } from './useAlbum'
import { albumsKeyRoot } from './useAlbums'

const route = getRouteApi('/authed/shell/albums/$id')

const MENU_ITEM =
  'flex min-h-11 cursor-default items-center gap-3 rounded-lg px-3 text-sm outline-none select-none data-[highlighted]:bg-accent'

// 사진 수, 영상 수, 촬영 기간 메타 줄. 0 항목 생략, 같은 해면 끝 연도 생략, 하루면 날짜 하나.
function metaLine(t: TFunction, lng: string, a: AlbumSummary): string {
  let range: string | null = null
  if (a.from && a.to) {
    range =
      a.from === a.to
        ? formatDate(a.from, lng)
        : t('albums.range', {
            from: formatDate(a.from, lng),
            to:
              a.from.slice(0, 4) === a.to.slice(0, 4)
                ? formatMonthDay(a.to, lng)
                : formatDate(a.to, lng),
          })
  }
  return [
    a.photo_count > 0 ? t('albums.metaPhotos', { count: a.photo_count }) : null,
    a.video_count > 0 ? t('albums.metaVideos', { count: a.video_count }) : null,
    range,
  ]
    .filter(Boolean)
    .join(' · ')
}

// 이름 바꾸기, 앨범 지우기. owner, guardian 만.
function AlbumMenu({
  album,
  disabled,
}: {
  album: AlbumSummary
  disabled: boolean
}) {
  const { t } = useTranslation()
  const router = useRouter()
  const canGoBack = useCanGoBack()
  const qc = useQueryClient()
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const rename = useMutation({
    mutationFn: (name: string) =>
      call(
        api.PATCH('/api/albums/{id}', {
          params: { path: { id: album.id } },
          body: { name },
        }),
      ),
    onSuccess: (a) => {
      qc.setQueryData(albumKey(a.id), a)
      void qc.invalidateQueries({ queryKey: albumsKeyRoot, exact: true })
      setRenaming(false)
    },
  })

  const remove = useMutation({
    mutationFn: () =>
      call(
        api.DELETE('/api/albums/{id}', {
          params: { path: { id: album.id } },
        }),
      ),
    onSuccess: () => {
      setDeleting(false)
      toast(t('albums.deleted'))
      // 사진 상세 album_ids.
      void qc.invalidateQueries({ queryKey: ['asset'] })
      // 앨범 탭이 재조회 전에 지운 앨범을 잠깐 보이지 않게.
      qc.setQueryData<AlbumSummary[]>([...albumsKeyRoot], (list) =>
        list?.filter((x) => x.id !== album.id),
      )
      // 화면을 떠난 뒤 제거(남은 화면의 재조회 404 알림 방지).
      const unsubscribe = router.subscribe('onRendered', () => {
        unsubscribe()
        qc.removeQueries({ queryKey: albumKey(album.id) })
        void qc.invalidateQueries({ queryKey: albumsKeyRoot, exact: true })
      })
      if (canGoBack) router.history.back()
      else void router.navigate({ to: '/albums', replace: true })
    },
  })

  return (
    <>
      {/* 메뉴에서 대화상자를 여니 비모달. */}
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('albums.menu')}
            disabled={disabled}
          >
            <IconMore aria-hidden className="size-6" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={4}
            className="z-50 min-w-40 rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg"
          >
            <DropdownMenu.Item
              className={MENU_ITEM}
              onSelect={() => {
                rename.reset()
                setRenaming(true)
              }}
            >
              {t('albums.rename')}
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className={cn(MENU_ITEM, 'text-destructive')}
              onSelect={() => {
                remove.reset()
                setDeleting(true)
              }}
            >
              {t('albums.delete')}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <AlbumNameDialog
        open={renaming}
        onOpenChange={setRenaming}
        title={t('albums.rename')}
        submitLabel={t('common.save')}
        initialName={album.name}
        pending={rename.isPending}
        error={rename.error}
        onSubmit={(name) => {
          rename.mutate(name)
        }}
      />
      <Dialog open={deleting} onOpenChange={setDeleting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('albums.deleteTitle')}</DialogTitle>
            <DialogDescription>
              {t('albums.deleteDescription')}
            </DialogDescription>
          </DialogHeader>
          <FormError error={remove.error} />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleting(false)
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => {
                remove.mutate()
              }}
            >
              {t('albums.deleteSubmit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// /albums/$id. 메타 줄, 쓰기 버튼(owner, guardian), 촬영 오래된 순 격자. 고르기 모드로 빼기.
export function AlbumPage() {
  const { t, i18n } = useTranslation()
  const { id } = route.useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const canWrite = hasRole(useMe().user, 'guardian')
  const online = useBrowserOnline()
  const timezone = useSettings()?.timezone
  const album = useAlbum(id)
  const assets = useAlbumAssets(id)
  const [adding, setAdding] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())

  // 지워진 앨범. 앨범 탭으로 교체 이동 + 알림(같은 id 로 중복 알림 방지).
  const missing = album.error instanceof ApiError && album.error.status === 404
  const missingError = missing ? album.error : null
  useEffect(() => {
    if (!missingError) return
    toast.error(errorMessage(t, missingError), { id: 'album-missing' })
    void navigate({ to: '/albums', replace: true })
  }, [missingError, navigate, t])

  const toggle = useCallback((assetId: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (!next.delete(assetId)) next.add(assetId)
      return next
    })
  }, [])
  // 고르기 모드 전환 뒤 포커스. 들어가면 취소, 나오면 고르기 버튼(숨는 버튼에 포커스가 남지 않게).
  const selectButton = useRef<HTMLButtonElement>(null)
  const cancelButton = useRef<HTMLButtonElement>(null)
  const focusAfter = useRef<'cancel' | 'select' | null>(null)
  useEffect(() => {
    const target = focusAfter.current
    focusAfter.current = null
    if (target === 'cancel') cancelButton.current?.focus()
    else if (target === 'select') selectButton.current?.focus()
  }, [selecting])
  const startSelect = () => {
    focusAfter.current = 'cancel'
    setSelecting(true)
  }
  const endSelect = () => {
    focusAfter.current = 'select'
    setSelecting(false)
    setSelected(new Set())
  }

  const remove = useMutation({
    mutationFn: (ids: string[]) =>
      call(
        api.POST('/api/albums/{id}/assets/remove', {
          params: { path: { id } },
          body: { asset_ids: ids },
        }),
      ),
    onSuccess: (_, ids) => {
      void qc.invalidateQueries({ queryKey: albumsKeyRoot })
      // 사진 상세 album_ids.
      void qc.invalidateQueries({ queryKey: ['asset'] })
      toast(t('albums.removed', { count: ids.length }))
      endSelect()
    },
    onError: (e) => {
      if (!isLogoutError(e)) toast.error(errorMessage(t, e))
    },
  })

  const a = missing ? undefined : album.data
  const meta = a ? metaLine(t, i18n.language, a) : ''

  return (
    <MeSubPage
      title={a?.name ?? t('albums.title')}
      backTo="/albums"
      actions={
        a && canWrite && !selecting ? (
          <AlbumMenu album={a} disabled={!online} />
        ) : undefined
      }
    >
      {album.isLoadingError && !missing && (
        <div className="grid justify-items-start gap-3">
          <p className="text-sm">{errorMessage(t, album.error)}</p>
          <Button variant="outline" onClick={() => void album.refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      )}
      {a && (
        <>
          {meta && (
            <p className="-mt-3 text-xs text-muted-foreground tabular-nums">
              {meta}
            </p>
          )}
          {canWrite && !selecting && (
            <div className="flex gap-2">
              <Button
                className="h-11 rounded-full bg-accent-soft px-4 text-xs font-semibold text-accent-ink hover:bg-accent-soft/80"
                disabled={!online}
                onClick={() => {
                  setAdding(true)
                }}
              >
                <IconAdd aria-hidden className="size-5" />
                {t('albums.addPhotos')}
              </Button>
              {/* 뺄 사진이 있을 때만. */}
              {assets.items.length > 0 && (
                <Button
                  ref={selectButton}
                  variant="secondary"
                  className="h-11 rounded-full px-4 text-xs font-semibold"
                  disabled={!online}
                  onClick={startSelect}
                >
                  {t('albums.select')}
                </Button>
              )}
            </div>
          )}
          <AssetGrid
            {...assets}
            timezone={timezone}
            linkSearch={{ from: 'album', of: id }}
            label={t('albums.photoGrid')}
            empty={canWrite ? t('albums.empty') : t('albums.emptyFamily')}
            selectable={selecting}
            selected={selected}
            onToggle={toggle}
          />
          {selecting && (
            // 휴대폰은 하단 탭(h-14 + 테두리) 위에 고정.
            <div className="sticky bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-10 -mx-4 flex gap-2 border-t bg-background px-4 py-2 lg:bottom-0">
              <Button
                ref={cancelButton}
                variant="outline"
                className="flex-1"
                onClick={endSelect}
              >
                {t('common.cancel')}
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                disabled={selected.size === 0 || remove.isPending || !online}
                onClick={() => {
                  remove.mutate([...selected])
                }}
              >
                {t('albums.removeSelected', { count: selected.size })}
              </Button>
            </div>
          )}
          {adding && (
            <AddPhotosSheet
              albumId={id}
              onClose={() => {
                setAdding(false)
              }}
            />
          )}
        </>
      )}
    </MeSubPage>
  )
}
