import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getRouteApi,
  Link,
  useCanGoBack,
  useRouter,
} from '@tanstack/react-router'
import IconBack from '~icons/material-symbols/arrow-back-rounded'
import IconLike from '~icons/material-symbols/favorite-outline-rounded'
import IconLiked from '~icons/material-symbols/favorite-rounded'
import IconMore from '~icons/material-symbols/more-vert-rounded'
import { DropdownMenu } from 'radix-ui'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api, call } from '@/api/client'
import { ApiError } from '@/api/errors'
import type { Story } from '@/api/types'
import { hasRole, useMe } from '@/auth/session'
import { CommentThread } from '@/comments/Comments'
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
import { AgeLine, ageParts } from '@/feed/dayMeta'
import { errorMessage } from '@/i18n'
import { formatDay, formatDayWithYear } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useUsers } from '@/members/useUsers'
import { useBrowserOnline } from '@/pwa/OfflineBanner'
import { LikersSheet } from '@/reactions/LikersSheet'
import { useToggleLike } from '@/reactions/useReactions'
import { useSettings, useToday } from '@/settings/useSettings'
import { Tile } from '@/timeline/Tile'
import { useBabies } from '@/timeline/useBabies'
import { MentionText } from './StoryBlock'
import { storyKey, storyQuery } from './useStory'

const route = getRouteApi('/authed/shell/stories/$id')

const MENU_ITEM =
  'flex min-h-11 cursor-default items-center gap-3 rounded-lg px-3 text-sm outline-none select-none data-[highlighted]:bg-accent'

// 처리 중 사진이 있으면 끝날 때까지 상세 재조회.
const POLL_MS = 5000

// 고치기는 작성자(보호자 이상), 지우기는 작성자 또는 보호자 이상.
function StoryMenu({ story }: { story: Story }) {
  const { t } = useTranslation()
  const { user } = useMe()
  const router = useRouter()
  const canGoBack = useCanGoBack()
  const qc = useQueryClient()
  const [deleting, setDeleting] = useState(false)
  const mine = user?.id === story.author_id
  const canEdit = mine && hasRole(user, 'guardian')
  const canDelete = mine || hasRole(user, 'guardian')

  const remove = useMutation({
    mutationFn: () =>
      call(
        api.DELETE('/api/stories/{id}', {
          params: { path: { id: story.id } },
        }),
      ),
    onSuccess: () => {
      setDeleting(false)
      void qc.invalidateQueries({ queryKey: ['days'] })
      toast(t('stories.deleted'))
      if (canGoBack) router.history.back()
      else void router.navigate({ to: '/', replace: true })
      // 다시 열면 캐시 대신 서버 응답(404).
      qc.removeQueries({ queryKey: storyKey(story.id) })
    },
  })

  if (!canEdit && !canDelete) return null
  return (
    <>
      {/* 메뉴에서 대화상자를 여니 비모달. */}
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <Button variant="ghost" size="icon" aria-label={t('stories.menu')}>
            <IconMore aria-hidden className="size-6" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={4}
            className="z-50 min-w-40 rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg"
          >
            {canEdit && (
              <DropdownMenu.Item
                className={MENU_ITEM}
                onSelect={() => {
                  void router.navigate({
                    to: '/stories/$id/edit',
                    params: { id: story.id },
                  })
                }}
              >
                {t('stories.edit')}
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Item
              className={cn(MENU_ITEM, 'text-destructive')}
              onSelect={() => {
                remove.reset()
                setDeleting(true)
              }}
            >
              {t('stories.delete')}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <Dialog open={deleting} onOpenChange={setDeleting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('stories.deleteTitle')}</DialogTitle>
            <DialogDescription>
              {t('stories.deleteDescription')}
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
              {t('stories.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Reactions({ story }: { story: Story }) {
  const { t } = useTranslation()
  const online = useBrowserOnline()
  const like = useToggleLike({ kind: 'story', id: story.id })
  const [likersOpen, setLikersOpen] = useState(false)
  return (
    <div className="flex items-center gap-1 border-y py-1">
      <Button
        variant="ghost"
        size="icon"
        className="aria-disabled:opacity-50"
        aria-label={t('reactions.like')}
        aria-pressed={story.liked}
        aria-disabled={!online}
        onClick={
          online
            ? () => {
                like.mutate(!story.liked)
              }
            : undefined
        }
      >
        {story.liked ? (
          <IconLiked aria-hidden className="size-6 text-primary" />
        ) : (
          <IconLike aria-hidden className="size-6" />
        )}
      </Button>
      {/* 0 이면 볼 사람 없음. */}
      {story.like_count > 0 && (
        <Button
          variant="ghost"
          className="h-11 min-w-11 px-2 text-sm font-semibold tabular-nums"
          aria-label={t('reactions.likers', { count: story.like_count })}
          onClick={() => {
            setLikersOpen(true)
          }}
        >
          {story.like_count}
        </Button>
      )}
      <LikersSheet
        target={{ kind: 'story', id: story.id }}
        open={likersOpen}
        onOpenChange={setLikersOpen}
      />
    </div>
  )
}

// /stories/$id. 날짜와 나이, 쓴 사람, 본문 전체, 사진 격자, 하트, 댓글(같은 화면 안 목록).
export function StoryPage() {
  const { t, i18n } = useTranslation()
  const { id } = route.useParams()
  const router = useRouter()
  const canGoBack = useCanGoBack()
  const today = useToday()
  const timezone = useSettings()?.timezone
  const babies = useBabies().data
  const users = useUsers().data?.users ?? []
  const commentsId = useId()
  const story = useQuery({
    ...storyQuery(id),
    refetchInterval: (q) =>
      !q.state.error &&
      q.state.data?.assets.some((a) => a.status === 'processing')
        ? POLL_MS
        : false,
  })
  // 다른 곳에서 지워진 이야기. 이전 응답이 남아 있어도 찾을 수 없음으로.
  const missing = story.error instanceof ApiError && story.error.status === 404
  const s = missing ? undefined : story.data

  const title = s
    ? s.entry_date.slice(0, 4) === today.slice(0, 4)
      ? formatDay(s.entry_date, i18n.language)
      : formatDayWithYear(s.entry_date, i18n.language)
    : t('stories.title')

  let content
  if (s) {
    const author =
      users.find((u) => u.id === s.author_id)?.display_name ??
      t('comments.unknownUser')
    const ages = babies
      ? ageParts(
          t,
          { date: s.entry_date, baby_ids: s.baby_ids },
          babies,
          undefined,
        )
      : []
    content = (
      <>
        <div className="grid gap-1">
          <AgeLine parts={ages} className="text-xs" />
          <p className="flex flex-wrap gap-x-2 text-xs wrap-anywhere text-muted-foreground">
            <span className="font-semibold text-foreground">{author}</span>
            {s.edited_at && <span>{t('comments.edited')}</span>}
          </p>
        </div>
        <p className="text-sm leading-normal wrap-anywhere whitespace-pre-wrap">
          <MentionText body={s.body} users={users} />
        </p>
        {s.assets.length > 0 && (
          <ul
            aria-label={t('stories.photoGrid')}
            className="-mx-4 grid grid-cols-3 gap-[2px] sm:grid-cols-4"
          >
            {s.assets.map((a) => (
              <li key={a.id}>
                <Tile item={a} from="story" of={s.id} timezone={timezone} />
              </li>
            ))}
          </ul>
        )}
        <Reactions story={s} />
        <section aria-labelledby={commentsId} className="-mx-4 grid gap-2">
          <h2 id={commentsId} className="px-4 text-base font-bold">
            {t('comments.title', { count: s.comment_count })}
          </h2>
          <CommentThread target={{ kind: 'story', id: s.id }} />
        </section>
      </>
    )
  } else if (story.isError) {
    content = (
      <div className="grid justify-items-start gap-3 py-4">
        <p className="text-sm">{errorMessage(t, story.error)}</p>
        {missing ? (
          <Button asChild>
            <Link to="/">{t('day.home')}</Link>
          </Button>
        ) : (
          <Button variant="outline" onClick={() => void story.refetch()}>
            {t('common.retry')}
          </Button>
        )}
      </div>
    )
  } else {
    content = (
      <p className="py-4 text-sm text-muted-foreground">
        {t('common.loading')}
      </p>
    )
  }

  return (
    <div className="-mt-4 grid gap-4 lg:mx-auto lg:max-w-[640px]">
      <header className="sticky top-0 z-10 -mx-4 flex min-h-14 items-center gap-1 bg-background px-2 py-1">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('stories.back')}
          onClick={() => {
            if (canGoBack) router.history.back()
            else void router.navigate({ to: '/', replace: true })
          }}
        >
          <IconBack aria-hidden className="size-6" />
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-lg font-bold tabular-nums">
          {title}
        </h1>
        {s && <StoryMenu story={s} />}
      </header>
      {content}
    </div>
  )
}
