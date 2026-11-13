import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import IconAdd from '~icons/material-symbols/add-rounded'
import IconCheck from '~icons/material-symbols/check-rounded'
import IconAlbum from '~icons/material-symbols/photo-album-outline-rounded'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api, call } from '@/api/client'
import { isLogoutError } from '@/api/errors'
import type { AlbumSummary, Asset } from '@/api/types'
import { FormError } from '@/components/Field'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { errorMessage } from '@/i18n'
import { usePortalTheme } from '@/lib/portalTheme'
import { cn } from '@/lib/utils'
import { useBrowserOnline } from '@/pwa/OfflineBanner'
import { thumbUrl } from '@/timeline/media'
import { assetKey } from '@/timeline/useTimeline'
import { assetQuery } from '@/viewer/useAsset'
import { AlbumNameDialog } from './AlbumNameDialog'
import { albumsKeyRoot, useAlbums } from './useAlbums'

const ROW =
  'flex min-h-14 w-full items-center gap-3 rounded-xl px-2 text-left text-[15px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'

function withAlbum(a: Asset, albumId: string, on: boolean): Asset {
  if (a.album_ids.includes(albumId) === on) return a
  return {
    ...a,
    album_ids: on
      ? [...a.album_ids, albumId]
      : a.album_ids.filter((x) => x !== albumId),
  }
}

function Cover({ album }: { album: AlbumSummary }) {
  const cover = album.cover?.status === 'ready' ? album.cover : null
  return (
    <span
      aria-hidden
      className="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-accent-soft text-accent-ink"
      style={
        cover?.dominant_color
          ? { backgroundColor: cover.dominant_color }
          : undefined
      }
    >
      {cover ? (
        <img
          src={thumbUrl(cover.id)}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <IconAlbum className="size-5" />
      )}
    </span>
  )
}

// 뷰어 ⋮ "앨범에 담기". 체크 즉시 넣기/빼기(저장 버튼 없음). 체크 상태는 사진 상세 album_ids.
// 테마는 포털 테마(뷰어 위면 어둡게).
export function AlbumPickSheet({
  assetId,
  onClose,
}: {
  assetId: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const theme = usePortalTheme()
  const online = useBrowserOnline()
  const albums = useAlbums()
  const asset = useQuery(assetQuery(assetId)).data
  const [creating, setCreating] = useState(false)
  const key = assetKey(assetId)
  const mutationKey = ['albumToggle', assetId]

  // 상세 캐시에 즉시 반영. 같은 사진의 넣기/빼기는 누른 순서대로 전송.
  // 되돌리기는 그 앨범만(사이에 누른 다른 앨범 체크 유지).
  const toggle = useMutation({
    mutationKey,
    scope: { id: mutationKey.join(':') },
    mutationFn: ({ albumId, on }: { albumId: string; on: boolean }) => {
      const opts = {
        params: { path: { id: albumId } },
        body: { asset_ids: [assetId] },
      }
      return on
        ? call(api.POST('/api/albums/{id}/assets', opts))
        : call(api.POST('/api/albums/{id}/assets/remove', opts))
    },
    onMutate: async ({ albumId, on }) => {
      // 진행 중 상세 조회가 즉시 반영을 덮지 않게.
      await qc.cancelQueries({ queryKey: key })
      qc.setQueryData<Asset>(key, (a) => a && withAlbum(a, albumId, on))
    },
    onError: (e, { albumId, on }) => {
      qc.setQueryData<Asset>(key, (a) => a && withAlbum(a, albumId, !on))
      if (!isLogoutError(e)) toast.error(errorMessage(t, e))
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: albumsKeyRoot })
      // 마지막 요청 뒤에만 서버 값으로 맞춤. 중간 재조회는 뒤이은 누름의 즉시 반영을 되돌림.
      if (qc.isMutating({ mutationKey }) === 1) {
        void qc.invalidateQueries({ queryKey: ['asset'] })
      }
    },
  })

  const create = useMutation({
    mutationFn: (name: string) =>
      call(api.POST('/api/albums', { body: { name, asset_ids: [assetId] } })),
    onSuccess: (album) => {
      qc.setQueryData<Asset>(key, (a) => a && withAlbum(a, album.id, true))
      void qc.invalidateQueries({ queryKey: albumsKeyRoot })
      void qc.invalidateQueries({ queryKey: ['asset'] })
      setCreating(false)
    },
  })

  return (
    <>
      <Sheet
        open
        onOpenChange={(open) => {
          if (!open) onClose()
        }}
      >
        <SheetContent
          side="bottom"
          aria-describedby={undefined}
          className={cn(
            theme,
            'mx-auto max-h-[85dvh] w-full max-w-lg gap-0 overflow-y-auto text-foreground',
          )}
        >
          <SheetHeader className="pr-14">
            <SheetTitle className="text-base">{t('albums.addTo')}</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {albums.data ? (
              <ul className="-mx-2 grid gap-1">
                {albums.data.map((a) => {
                  const checked = asset?.album_ids.includes(a.id) ?? false
                  return (
                    <li key={a.id}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={checked}
                        disabled={!asset || !online}
                        className={ROW}
                        onClick={() => {
                          toggle.mutate({ albumId: a.id, on: !checked })
                        }}
                      >
                        <Cover album={a} />
                        <span className="min-w-0 flex-1 truncate">
                          {a.name}
                        </span>
                        <span
                          aria-hidden
                          className={cn(
                            'grid size-5 shrink-0 place-items-center rounded-md border-[1.5px]',
                            checked
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-input',
                          )}
                        >
                          {checked && <IconCheck className="size-4" />}
                        </span>
                      </button>
                    </li>
                  )
                })}
                <li>
                  <button
                    type="button"
                    disabled={!online}
                    className={cn(ROW, 'font-semibold text-accent-ink')}
                    onClick={() => {
                      create.reset()
                      setCreating(true)
                    }}
                  >
                    <span
                      aria-hidden
                      className="grid size-10 shrink-0 place-items-center"
                    >
                      <IconAdd className="size-6" />
                    </span>
                    {t('albums.createAndAdd')}
                  </button>
                </li>
              </ul>
            ) : albums.isError ? (
              <div className="grid justify-items-start gap-3">
                <FormError error={albums.error} />
                <Button variant="outline" onClick={() => void albums.refetch()}>
                  {t('common.retry')}
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t('common.loading')}
              </p>
            )}
          </div>
        </SheetContent>
      </Sheet>
      <AlbumNameDialog
        open={creating}
        onOpenChange={setCreating}
        title={t('albums.new')}
        submitLabel={t('albums.create')}
        pending={create.isPending}
        error={create.error}
        onSubmit={(name) => {
          create.mutate(name)
        }}
      />
    </>
  )
}
