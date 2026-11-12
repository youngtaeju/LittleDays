import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import {
  Navigate,
  getRouteApi,
  useBlocker,
  useCanGoBack,
  useRouter,
} from '@tanstack/react-router'
import IconAddPhoto from '~icons/material-symbols/add-a-photo-outline-rounded'
import IconPhotos from '~icons/material-symbols/photo-library-outline-rounded'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api, call } from '@/api/client'
import type { AssetSummary, AttachTarget, Baby, Story, User } from '@/api/types'
import { useMe } from '@/auth/session'
import { MentionTextarea, type MentionValue } from '@/comments/MentionTextarea'
import { toBody, toEditable } from '@/comments/mentions'
import { Field, FormError } from '@/components/Field'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { isCalendarDate } from '@/lib/dates'
import { useUsers } from '@/members/useUsers'
import { RoutePending } from '@/pages/RouteError'
import { useSettingsQuery, useToday } from '@/settings/useSettings'
import { useBabies } from '@/timeline/useBabies'
import { mediaKind } from '@/upload/fileKind'
import { BabyPicker } from '@/upload/UploadConfirm'
import { ACCEPTED_FILE_TYPES } from '@/upload/useUploadStore'
import { AssetPickerSheet } from './AssetPickerSheet'
import { PhotoStrip, type StripItem } from './PhotoStrip'
import { storyKey, storyQuery } from './useStory'

// 서버와 같은 기준. 앞뒤 공백 제거 후 유니코드 문자 수.
const MAX_CHARS = 5000

const newRoute = getRouteApi('/authed/shell/stories/new')
const editRoute = getRouteApi('/authed/shell/stories/$id/edit')

interface Draft {
  date: string
  babyIds: string[]
  value: MentionValue
  items: StripItem[]
}

function assetItem(asset: AssetSummary): StripItem {
  return { key: `a:${asset.id}`, kind: 'asset', asset }
}

function assetIds(items: readonly StripItem[]): string[] {
  return items.flatMap((i) => (i.kind === 'asset' ? [i.asset.id] : []))
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x))
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

function move<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list]
  const [x] = next.splice(from, 1)
  if (x !== undefined) next.splice(to, 0, x)
  return next
}

// 업로드 큐는 지연 로딩. 실패 시 이야기는 저장된 채 안내만.
async function queueFiles(
  qc: QueryClient,
  files: File[],
  babyIds: string[],
  attach: AttachTarget,
): Promise<boolean> {
  try {
    const { getUploader } = await import('@/upload/uploader')
    getUploader(qc).add(files, babyIds, attach)
    return true
  } catch {
    return false
  }
}

// /stories/new. 날짜 기본값 = ?date=(오늘 이전) 또는 인스턴스 오늘.
export function StoryNewPage() {
  const { t } = useTranslation()
  const search = newRoute.useSearch()
  const today = useToday()
  const settings = useSettingsQuery()
  const babies = useBabies()
  const users = useUsers()
  if (settings.isPending || babies.isPending) return <RoutePending />
  if (babies.isError) return <LoadError error={babies.error} />
  const list = babies.data
  const initial: Draft = {
    date: search.date && search.date <= today ? search.date : today,
    // 아기 1명이면 선택된 채.
    babyIds: list.length === 1 ? list.map((b) => b.id) : [],
    value: { text: '', picked: [] },
    items: [],
  }
  return (
    <StoryForm
      title={t('stories.newTitle')}
      initial={initial}
      babies={list}
      users={users.data?.users ?? []}
      today={today}
    />
  )
}

// /stories/$id/edit. 작성자 아니면 상세로(라우트 진입 검사와 같은 규칙).
export function StoryEditPage() {
  const { t } = useTranslation()
  const { id } = editRoute.useParams()
  const { user } = useMe()
  const today = useToday()
  // 고치는 동안 재조회 없음. 시작 값은 폼이 마운트 때 고정, 저장 직전 재조회는 따로.
  const story = useQuery({
    ...storyQuery(id),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })
  const babies = useBabies()
  const users = useUsers()
  if (story.isPending || babies.isPending || users.isPending) {
    return <RoutePending />
  }
  if (story.isError) return <LoadError error={story.error} />
  if (user && story.data.author_id !== user.id) {
    return <Navigate to="/stories/$id" params={{ id }} replace />
  }
  const s = story.data
  // 멤버 목록 실패 시 멘션은 토큰 그대로(같은 본문으로 되돌아감).
  const people = users.data?.users ?? []
  const initial: Draft = {
    date: s.entry_date,
    babyIds: s.baby_ids,
    value: toEditable(s.body, people),
    items: s.assets.map(assetItem),
  }
  return (
    <StoryForm
      title={t('stories.editTitle')}
      story={s}
      initial={initial}
      babies={babies.data ?? []}
      users={people}
      today={today}
    />
  )
}

function LoadError({ error }: { error: unknown }) {
  return (
    <div className="p-6">
      <FormError error={error} />
    </div>
  )
}

// 쓰기와 고치기 공용. story 가 있으면 고치기(PATCH), 없으면 쓰기(POST).
function StoryForm({
  title,
  story,
  initial,
  babies,
  users,
  today,
}: {
  title: string
  story?: Story
  initial: Draft
  babies: Baby[]
  users: User[]
  today: string
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const router = useRouter()
  const canGoBack = useCanGoBack()
  // 비교 기준은 마운트 때 값으로 고정. 상세 재조회로 서버 쪽 사진이 바뀌어도 사용자 변경으로 보지 않음.
  const [base] = useState(() => ({
    ...initial,
    ids: assetIds(initial.items),
    body: story?.body,
  }))
  const [date, setDate] = useState(initial.date)
  const [babyIds, setBabyIds] = useState(initial.babyIds)
  const [value, setValue] = useState(initial.value)
  const [items, setItems] = useState(initial.items)
  const [picking, setPicking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const nextKey = useRef(0)

  const body = toBody(value.text, value.picked).trim()
  const length = Array.from(body).length
  const over = length > MAX_CHARS
  const validDate = isCalendarDate(date)
  const future = validDate && date > today
  const files = items.flatMap((i) => (i.kind === 'file' ? [i.file] : []))
  const ids = assetIds(items)

  const fieldsChanged = story
    ? {
        date: date !== base.date,
        babies: !sameSet(babyIds, base.babyIds),
        body: body !== base.body,
        assets: !sameList(ids, base.ids),
      }
    : null
  // 쓰기는 내용(본문, 사진)이 있을 때, 고치기는 처음과 다를 때 나가기 확인.
  const dirty = fieldsChanged
    ? Object.values(fieldsChanged).some(Boolean) || files.length > 0
    : body !== '' || items.length > 0
  const canSubmit = body !== '' && !over && validDate && !future && !saving

  // 탭, 링크, 뒤로 가기 등 다른 이동. 취소 버튼은 직접 확인(asking).
  const blocker = useBlocker({
    shouldBlockFn: () => true,
    disabled: !dirty,
    withResolver: true,
  })
  const [asking, setAsking] = useState(false)

  // 기록 있으면 되돌아가기, 직접 진입이면 상세(고치기) 또는 홈.
  function leave() {
    const opts = { ignoreBlocker: true }
    if (canGoBack) router.history.back(opts)
    else if (story) {
      void router.navigate({
        to: '/stories/$id',
        params: { id: story.id },
        ...opts,
      })
    } else void router.navigate({ to: '/', ...opts })
  }

  function cancel() {
    if (dirty) setAsking(true)
    else leave()
  }

  function keepWriting() {
    setAsking(false)
    blocker.reset?.()
  }

  function discard() {
    if (asking) {
      setAsking(false)
      leave()
    } else blocker.proceed?.()
  }

  function toggleBaby(id: string) {
    const next = babyIds.includes(id)
      ? babyIds.filter((x) => x !== id)
      : [...babyIds, id]
    // 아기 표시 순서.
    setBabyIds(babies.filter((b) => next.includes(b.id)).map((b) => b.id))
  }

  function addFiles(list: File[]) {
    const media = list.filter((f) => mediaKind(f) !== null)
    if (media.length < list.length) toast.error(t('upload.status.unsupported'))
    if (media.length === 0) return
    const added = media.map((file): StripItem => ({
      key: `f:${String(nextKey.current++)}`,
      kind: 'file',
      file,
    }))
    setItems((prev) => [...prev, ...added])
  }

  // 고른 결과로 교체. 빠진 사진은 제거, 새로 고른 사진은 맨 뒤. 기기 파일은 그대로.
  function applyPicked(assets: AssetSummary[]) {
    const keep = new Set(assets.map((a) => a.id))
    setItems((prev) => {
      const kept = prev.filter((i) => i.kind === 'file' || keep.has(i.asset.id))
      const have = new Set(assetIds(kept))
      return [...kept, ...assets.filter((a) => !have.has(a.id)).map(assetItem)]
    })
    setPicking(false)
  }

  async function create(): Promise<string> {
    const created = await call(
      api.POST('/api/stories', {
        body: { entry_date: date, body, baby_ids: babyIds, asset_ids: ids },
      }),
    )
    qc.setQueryData(storyKey(created.id), created)
    void qc.invalidateQueries({ queryKey: ['days'] })
    return created.id
  }

  // 바꾼 필드만. 사진을 바꿨으면 저장 직전 상세를 다시 받아
  // 그사이 백그라운드 업로드로 붙은 사진(처음 목록에 없던 서버 연결)을 뒤에 보존.
  async function update(s: Story): Promise<void> {
    if (!fieldsChanged) return
    const patch: {
      entry_date?: string
      baby_ids?: string[]
      body?: string
      asset_ids?: string[]
    } = {}
    if (fieldsChanged.date) patch.entry_date = date
    if (fieldsChanged.babies) patch.baby_ids = babyIds
    if (fieldsChanged.body) patch.body = body
    if (fieldsChanged.assets) {
      const fresh = await qc.query({ ...storyQuery(s.id), staleTime: 0 })
      const added = fresh.assets
        .map((a) => a.id)
        .filter((id) => !base.ids.includes(id) && !ids.includes(id))
      patch.asset_ids = [...ids, ...added]
    }
    if (Object.keys(patch).length === 0) return
    const updated = await call(
      api.PATCH('/api/stories/{id}', {
        params: { path: { id: s.id } },
        body: patch,
      }),
    )
    qc.setQueryData(storyKey(s.id), updated)
    void qc.invalidateQueries({ queryKey: ['days'] })
  }

  async function submit() {
    if (!canSubmit) return
    setSaving(true)
    setError(null)
    try {
      let id: string
      if (story) {
        await update(story)
        id = story.id
      } else {
        id = await create()
      }
      // 저장 뒤 새 파일은 기존 업로드 큐로. 끝나는 대로 서버가 이 이야기에 연결.
      if (files.length > 0) {
        const queued = await queueFiles(qc, files, babyIds, {
          kind: 'story',
          id,
        })
        if (!queued) toast.error(t('stories.uploadFailed'))
      }
      await router.navigate({
        to: '/stories/$id',
        params: { id },
        replace: true,
        ignoreBlocker: true,
      })
    } catch (e) {
      setError(e)
      setSaving(false)
    }
  }

  return (
    <div className="-mt-4 grid gap-4 lg:mx-auto lg:max-w-2xl">
      <header className="sticky top-0 z-10 -mx-4 flex min-h-14 items-center gap-1 border-b bg-background px-2 py-1">
        <Button variant="ghost" className="text-[15px]" onClick={cancel}>
          {t('common.cancel')}
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-center text-[17px] font-bold">
          {title}
        </h1>
        <Button
          variant="ghost"
          className="text-[15px] font-bold text-accent-ink"
          disabled={!canSubmit}
          onClick={() => void submit()}
        >
          {story ? t('common.save') : t('stories.post')}
        </Button>
      </header>

      <Field
        label={t('stories.date')}
        type="date"
        value={date}
        max={today}
        required
        onChange={(e) => {
          setDate(e.target.value)
        }}
        error={future ? t('errors.story.dateInvalid') : null}
      />

      {babies.length > 0 && (
        <BabyPicker babies={babies} selected={babyIds} onToggle={toggleBaby} />
      )}

      <div className="relative grid gap-1">
        <MentionTextarea
          users={users}
          value={value}
          onChange={setValue}
          onSubmit={() => void submit()}
          listClassName="inset-x-0 top-full z-20 mt-1"
          aria-label={t('stories.body')}
          placeholder={t('stories.placeholder')}
          aria-invalid={over || undefined}
          className="min-h-40 text-[15px] leading-relaxed md:text-[15px]"
        />
        {over && (
          <p className="text-xs text-destructive tabular-nums">
            {t('stories.counter', { count: length })}
          </p>
        )}
      </div>

      <section className="grid gap-2">
        {items.length > 0 && (
          <>
            <p className="flex justify-between text-[13px] font-bold">
              {t('stories.photos')}
              <span className="font-normal text-muted-foreground">
                {t('stories.photoCount', { count: items.length })}
              </span>
            </p>
            <PhotoStrip
              items={items}
              onRemove={(key) => {
                setItems((prev) => prev.filter((i) => i.key !== key))
              }}
              onReorder={(key, to) => {
                setItems((prev) => {
                  const from = prev.findIndex((i) => i.key === key)
                  return from < 0 ? prev : move(prev, from, to)
                })
              }}
            />
          </>
        )}
        <Button
          variant="outline"
          className="h-12 text-[15px] font-semibold"
          onClick={() => {
            setPicking(true)
          }}
        >
          <IconPhotos aria-hidden className="size-5" />
          {t('stories.pickExisting')}
        </Button>
        <Button
          variant="outline"
          className="h-12 text-[15px] font-semibold"
          onClick={() => {
            fileInput.current?.click()
          }}
        >
          <IconAddPhoto aria-hidden className="size-5" />
          {t('stories.uploadNew')}
        </Button>
        {files.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {t('stories.uploadHint')}
          </p>
        )}
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={ACCEPTED_FILE_TYPES.join(',')}
          className="hidden"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const list = [...(e.currentTarget.files ?? [])]
            // 같은 파일 다시 선택 허용.
            e.currentTarget.value = ''
            addFiles(list)
          }}
        />
      </section>

      <FormError error={error} />

      {picking && (
        <AssetPickerSheet
          date={validDate ? date : undefined}
          selected={items.flatMap((i) => (i.kind === 'asset' ? [i.asset] : []))}
          onDone={applyPicked}
          onClose={() => {
            setPicking(false)
          }}
        />
      )}

      <Dialog
        open={asking || blocker.status === 'blocked'}
        onOpenChange={(open) => {
          if (!open) keepWriting()
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t('stories.discardTitle')}</DialogTitle>
            <DialogDescription>
              {t('stories.discardDescription')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={keepWriting}>
              {t('stories.keepWriting')}
            </Button>
            <Button variant="destructive" onClick={discard}>
              {t('stories.discard')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
