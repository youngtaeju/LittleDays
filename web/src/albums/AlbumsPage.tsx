import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import IconAdd from '~icons/material-symbols/add-rounded'
import IconMovie from '~icons/material-symbols/movie-outline-rounded'
import IconAlbum from '~icons/material-symbols/photo-album-outline-rounded'
import IconStar from '~icons/material-symbols/star-rounded'
import { useId, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { api, call } from '@/api/client'
import type { AlbumSummary } from '@/api/types'
import { hasRole, useMe } from '@/auth/session'
import { Avatar } from '@/babies/Avatar'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/i18n'
import { useBrowserOnline } from '@/pwa/OfflineBanner'
import { thumbUrl } from '@/timeline/media'
import { useBabies } from '@/timeline/useBabies'
import { AlbumNameDialog } from './AlbumNameDialog'
import { albumKey } from './useAlbum'
import { albumsKeyRoot, useAlbums } from './useAlbums'

const TILE =
  'flex min-h-14 items-center gap-2.5 rounded-xl bg-muted p-2.5 focus-visible:outline-2 focus-visible:outline-ring'

function TileIcon({ children }: { children: ReactNode }) {
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-ink">
      {children}
    </span>
  )
}

function TileText({ name, sub }: { name: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-xs font-semibold">{name}</div>
      {sub && (
        <div className="truncate text-2xs text-muted-foreground">{sub}</div>
      )}
    </div>
  )
}

// 표지(정사각, 없으면 옅은 면 + 아이콘), 이름, 사진+영상 수.
function AlbumTile({ album }: { album: AlbumSummary }) {
  const { t } = useTranslation()
  const count = album.photo_count + album.video_count
  const cover = album.cover?.status === 'ready' ? album.cover : null
  return (
    <Link
      to="/albums/$id"
      params={{ id: album.id }}
      aria-label={t('albums.tile', { name: album.name, count })}
      className="grid gap-1 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <span
        className="relative block aspect-square overflow-hidden rounded-xl bg-accent-soft"
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
          <IconAlbum
            aria-hidden
            className="absolute inset-0 m-auto size-10 text-accent-ink"
          />
        )}
      </span>
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className="truncate text-xs font-semibold">{album.name}</span>
        <span className="shrink-0 text-2xs text-muted-foreground tabular-nums">
          {count}
        </span>
      </span>
    </Link>
  )
}

// 앨범 탭. 고정 타일(즐겨찾기, 영상, 아이별 개월 앨범, 개수 표시 없음) + 우리 앨범.
export function AlbumsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const babies = useBabies().data ?? []
  const albums = useAlbums()
  const canWrite = hasRole(useMe().user, 'guardian')
  const online = useBrowserOnline()
  const oursId = useId()
  const [creating, setCreating] = useState(false)

  // 빈 앨범. asset_ids 키를 보내면 넣기 검증(빈 배열 400).
  const create = useMutation({
    mutationFn: (name: string) =>
      call(api.POST('/api/albums', { body: { name } })),
    onSuccess: (album) => {
      qc.setQueryData(albumKey(album.id), album)
      void qc.invalidateQueries({ queryKey: albumsKeyRoot, exact: true })
      setCreating(false)
      void navigate({ to: '/albums/$id', params: { id: album.id } })
    },
  })
  const startCreate = () => {
    create.reset()
    setCreating(true)
  }

  const list = albums.data
  // family 는 앨범 없으면 영역 숨김. owner, guardian 은 새 앨범 칸.
  const showOurs = list ? list.length > 0 || canWrite : false

  return (
    <div className="mx-auto grid max-w-[960px] gap-2">
      <div className="flex h-14 items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{t('albums.title')}</h1>
        {canWrite && (
          <Button
            variant="ghost"
            className="-mr-2 px-2 text-xs font-semibold text-accent-ink"
            disabled={!online}
            onClick={startCreate}
          >
            <IconAdd aria-hidden className="size-5" />
            {t('albums.new')}
          </Button>
        )}
      </div>
      <ul
        aria-label={t('albums.fixed')}
        className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
      >
        <li>
          <Link to="/albums/favorites" className={TILE}>
            <TileIcon>
              <IconStar aria-hidden className="size-5" />
            </TileIcon>
            <TileText name={t('albums.favorites')} />
          </Link>
        </li>
        <li>
          <Link to="/albums/videos" className={TILE}>
            <TileIcon>
              <IconMovie aria-hidden className="size-5" />
            </TileIcon>
            <TileText name={t('albums.videos')} />
          </Link>
        </li>
        {babies.map((b) => (
          <li key={b.id}>
            <Link to="/babies/$id" params={{ id: b.id }} className={TILE}>
              <Avatar baby={b} size={36} />
              <TileText name={b.name} sub={t('albums.monthly')} />
            </Link>
          </li>
        ))}
      </ul>
      {albums.isLoadingError && (
        <div className="grid justify-items-start gap-3 pt-4">
          <p className="text-sm">{errorMessage(t, albums.error)}</p>
          <Button variant="outline" onClick={() => void albums.refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      )}
      {list && showOurs && (
        <section aria-labelledby={oursId} className="grid gap-2 pt-4">
          <h2 id={oursId} className="text-base font-bold">
            {t('albums.ours')}
          </h2>
          <ul
            aria-label={t('albums.ours')}
            className="grid grid-cols-2 gap-x-2.5 gap-y-3 sm:grid-cols-3 lg:grid-cols-4"
          >
            {list.map((a) => (
              <li key={a.id}>
                <AlbumTile album={a} />
              </li>
            ))}
            {canWrite && (
              <li>
                <button
                  type="button"
                  disabled={!online}
                  onClick={startCreate}
                  className="grid aspect-square w-full place-content-center justify-items-center gap-1 rounded-xl border-[1.5px] border-dashed text-xs text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
                >
                  <IconAdd aria-hidden className="size-6" />
                  {t('albums.new')}
                </button>
              </li>
            )}
          </ul>
        </section>
      )}
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
    </div>
  )
}
