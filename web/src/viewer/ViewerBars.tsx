import IconComment from '~icons/material-symbols/chat-bubble-outline-rounded'
import IconClose from '~icons/material-symbols/close-rounded'
import IconDelete from '~icons/material-symbols/delete-outline-rounded'
import IconDownload from '~icons/material-symbols/download-rounded'
import IconLike from '~icons/material-symbols/favorite-outline-rounded'
import IconLiked from '~icons/material-symbols/favorite-rounded'
import IconInfo from '~icons/material-symbols/info-outline-rounded'
import IconMore from '~icons/material-symbols/more-vert-rounded'
import IconStar from '~icons/material-symbols/star-outline-rounded'
import IconStarred from '~icons/material-symbols/star-rounded'
import IconZoomIn from '~icons/material-symbols/zoom-in-rounded'
import IconZoomOut from '~icons/material-symbols/zoom-out-rounded'
import { DropdownMenu } from 'radix-ui'
import { useTranslation } from 'react-i18next'
import { FormError } from '@/components/Field'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { useBrowserOnline } from '@/pwa/OfflineBanner'

// 사진 위에 겹치는 막대. 밝은 사진 위에서도 흰 글자 대비 유지(검정 70%).
const BAR =
  'absolute inset-x-0 z-10 bg-black/70 px-2 transition-opacity duration-200'

// 360px 폭에 아래 버튼 5개.
const BAR_BUTTON =
  "h-14 min-w-13 flex-col gap-0.5 px-2 text-2xs font-normal [&_svg:not([class*='size-'])]:size-6"

// 오프라인이면 포커스는 유지하고 동작만 막음.
const OFFLINE = 'aria-disabled:opacity-50'

const COUNT_BUTTON = 'h-14 min-w-11 px-2 text-sm font-semibold tabular-nums'

const MENU_ITEM =
  'flex min-h-11 cursor-default items-center gap-3 rounded-lg px-3 text-sm outline-none select-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent'

// 위: 닫기 / 시각, 나이 / 확대(데스크톱), 즐겨찾기, 더 보기. 아래 왼쪽: 하트, 댓글. 아래 오른쪽: 정보, 내려받기, 휴지통.
// 숨김 중엔 inert 로 포커스, 클릭 제외.
export function ViewerBars({
  visible,
  title,
  age,
  onClose,
  zoom,
  download,
  info,
  albums,
  onEditTakenAt,
  trash,
  reactions,
}: {
  visible: boolean
  title: string | null
  age: string
  onClose: () => void
  zoom: { zoomed: boolean; onToggle: () => void } | null
  download: { href: string; filename: string | undefined }
  info: { open: boolean; onToggle: () => void } | null
  // 앨범에 담기. 표지 지정, 빼기는 앨범에서 연 뷰어만. removing: 빼기 요청 중(다시 누름 방지).
  albums: {
    onAdd: () => void
    onSetCover: (() => void) | null
    onRemove: (() => void) | null
    removing: boolean
  } | null
  onEditTakenAt: (() => void) | null
  trash: {
    open: boolean
    onOpenChange: (open: boolean) => void
    onConfirm: () => void
    pending: boolean
    error: unknown
  } | null
  reactions: {
    liked: boolean
    likeCount: number
    favorited: boolean
    onLike: () => void
    onLikers: () => void
    onFavorite: () => void
    comments?: { count: number; open: boolean; onOpen: () => void }
  } | null
}) {
  const { t } = useTranslation()
  const online = useBrowserOnline()
  const hidden = !visible && 'opacity-0'
  const downloadAttr = download.filename ?? true

  return (
    <>
      <div
        inert={!visible}
        className={cn(
          BAR,
          'top-0 grid grid-cols-[1fr_auto_1fr] items-center gap-2 pt-[env(safe-area-inset-top)]',
          hidden,
        )}
      >
        <div className="flex h-14 items-center">
          {/* 진입 시 포커스를 뷰어 안으로. */}
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('common.close')}
            onClick={onClose}
            autoFocus
          >
            <IconClose className="size-6" />
          </Button>
        </div>
        <div className="min-w-0 text-center tabular-nums">
          {title && <p className="truncate text-sm font-semibold">{title}</p>}
          {age && <p className="truncate text-xs text-white/80">{age}</p>}
        </div>
        <div className="flex items-center justify-end">
          {/* 휴대폰은 핀치·두 번 누르기. 키보드·마우스용. */}
          {zoom && (
            <Button
              variant="ghost"
              size="icon"
              className="hidden lg:inline-flex"
              aria-label={
                zoom.zoomed ? t('viewer.zoomOut') : t('viewer.zoomIn')
              }
              onClick={zoom.onToggle}
            >
              {zoom.zoomed ? (
                <IconZoomOut className="size-6" />
              ) : (
                <IconZoomIn className="size-6" />
              )}
            </Button>
          )}
          {reactions && (
            <Button
              variant="ghost"
              size="icon"
              className={OFFLINE}
              aria-label={t('reactions.favorite')}
              aria-pressed={reactions.favorited}
              aria-disabled={!online}
              onClick={online ? reactions.onFavorite : undefined}
            >
              {reactions.favorited ? (
                <IconStarred className="size-6 text-primary" />
              ) : (
                <IconStar className="size-6" />
              )}
            </Button>
          )}
          {/* 메뉴에서 시트·대화상자를 여니 비모달(닫힌 메뉴가 포커스·포인터 잠금을 남기지 않게). */}
          <DropdownMenu.Root modal={false}>
            <DropdownMenu.Trigger asChild>
              <Button variant="ghost" size="icon" aria-label={t('viewer.more')}>
                <IconMore className="size-6" />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={4}
                className="dark z-50 min-w-48 rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg"
              >
                <DropdownMenu.Item asChild className={MENU_ITEM}>
                  <a href={download.href} download={downloadAttr}>
                    {t('viewer.downloadOriginal')}
                  </a>
                </DropdownMenu.Item>
                {/* 오프라인이면 막음. 대기한 요청이 재연결 때 나가 화면을 옮기지 않게. */}
                {albums && (
                  <DropdownMenu.Item
                    className={MENU_ITEM}
                    disabled={!online}
                    onSelect={albums.onAdd}
                  >
                    {t('albums.addTo')}
                  </DropdownMenu.Item>
                )}
                {albums?.onSetCover && (
                  <DropdownMenu.Item
                    className={MENU_ITEM}
                    disabled={!online}
                    onSelect={albums.onSetCover}
                  >
                    {t('albums.setCover')}
                  </DropdownMenu.Item>
                )}
                {albums?.onRemove && (
                  <DropdownMenu.Item
                    className={MENU_ITEM}
                    disabled={!online || albums.removing}
                    onSelect={albums.onRemove}
                  >
                    {t('albums.removeFromAlbum')}
                  </DropdownMenu.Item>
                )}
                {onEditTakenAt && (
                  <DropdownMenu.Item
                    className={MENU_ITEM}
                    onSelect={onEditTakenAt}
                  >
                    {t('viewer.editTakenAt')}
                  </DropdownMenu.Item>
                )}
                {trash && (
                  <DropdownMenu.Item
                    className={cn(MENU_ITEM, 'text-destructive')}
                    onSelect={() => {
                      trash.onOpenChange(true)
                    }}
                  >
                    {t('viewer.trash')}
                  </DropdownMenu.Item>
                )}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>

      <div
        inert={!visible}
        className={cn(
          BAR,
          'bottom-0 flex justify-between pb-[env(safe-area-inset-bottom)]',
          hidden,
        )}
      >
        <div className="flex">
          {reactions && (
            <>
              <Button
                variant="ghost"
                className={cn(BAR_BUTTON, OFFLINE)}
                aria-label={t('reactions.like')}
                aria-pressed={reactions.liked}
                aria-disabled={!online}
                onClick={online ? reactions.onLike : undefined}
              >
                {reactions.liked ? (
                  <IconLiked aria-hidden className="text-primary" />
                ) : (
                  <IconLike aria-hidden />
                )}
              </Button>
              {/* 0 이면 볼 사람 없음. 오프라인에도 캐시 목록은 열림. */}
              {reactions.likeCount > 0 && (
                <Button
                  variant="ghost"
                  className={COUNT_BUTTON}
                  aria-label={t('reactions.likers', {
                    count: reactions.likeCount,
                  })}
                  onClick={reactions.onLikers}
                >
                  {reactions.likeCount}
                </Button>
              )}
              {reactions.comments && (
                <Button
                  variant="ghost"
                  className={cn(
                    BAR_BUTTON,
                    'flex-row gap-1 text-sm font-semibold tabular-nums',
                  )}
                  aria-label={t('reactions.comments', {
                    count: reactions.comments.count,
                  })}
                  aria-pressed={reactions.comments.open}
                  onClick={reactions.comments.onOpen}
                >
                  <IconComment aria-hidden />
                  {reactions.comments.count > 0 && reactions.comments.count}
                </Button>
              )}
            </>
          )}
        </div>
        <div className="flex">
          {info && (
            <Button
              variant="ghost"
              className={BAR_BUTTON}
              aria-pressed={info.open}
              onClick={info.onToggle}
            >
              <IconInfo aria-hidden />
              {t('viewer.info')}
            </Button>
          )}
          <Button asChild variant="ghost" className={BAR_BUTTON}>
            <a href={download.href} download={downloadAttr}>
              <IconDownload aria-hidden />
              {t('viewer.download')}
            </a>
          </Button>
          {trash && (
            <Button
              variant="ghost"
              className={BAR_BUTTON}
              onClick={() => {
                trash.onOpenChange(true)
              }}
            >
              <IconDelete aria-hidden />
              {t('viewer.trashShort')}
            </Button>
          )}
        </div>
      </div>

      {trash && (
        <Dialog open={trash.open} onOpenChange={trash.onOpenChange}>
          <DialogContent className="dark text-foreground">
            <DialogHeader>
              <DialogTitle>{t('viewer.trashTitle')}</DialogTitle>
              <DialogDescription>
                {t('viewer.trashDescription')}
              </DialogDescription>
            </DialogHeader>
            <FormError error={trash.error} />
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">{t('common.cancel')}</Button>
              </DialogClose>
              <Button
                variant="destructive"
                disabled={trash.pending}
                onClick={trash.onConfirm}
              >
                {t('viewer.trash')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
