import { Link } from '@tanstack/react-router'
import IconMovie from '~icons/material-symbols/movie-outline-rounded'
import IconStar from '~icons/material-symbols/star-rounded'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Avatar } from '@/babies/Avatar'
import { useBabies } from '@/timeline/useBabies'

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

// 앨범 탭. 고정 타일(즐겨찾기, 영상, 아이별 개월 앨범). 개수 표시 없음.
export function AlbumsPage() {
  const { t } = useTranslation()
  const babies = useBabies().data ?? []
  return (
    <div className="mx-auto grid max-w-[960px] gap-2">
      <div className="flex h-14 items-center">
        <h1 className="text-xl font-bold">{t('albums.title')}</h1>
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
    </div>
  )
}
