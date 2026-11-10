import { useMutation, useQueryClient } from '@tanstack/react-query'
import IconEdit from '~icons/material-symbols/edit-outline-rounded'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api, call } from '@/api/client'
import type { Asset, Baby } from '@/api/types'
import { FormError } from '@/components/Field'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useUsers } from '@/members/useUsers'
import { useSettings } from '@/settings/useSettings'
import { babiesKey, useBabies } from '@/timeline/useBabies'
import { assetKey } from '@/timeline/useTimeline'
import { TakenAtEditor } from './TakenAtEditor'
import { applyAsset } from './useAsset'
import { formatInZone } from './zoned'

export type Editing = 'takenAt' | 'caption' | 'babies'

// 기기 메타데이터가 아닌 출처만 보조 표시.
const DEVICE_SOURCES = new Set<Asset['taken_at_source']>(['exif', 'video_meta'])

// 모델명에 제조사가 이미 있으면 모델명만.
function cameraText(make: string | null, model: string | null): string {
  if (make && model) {
    return model.toLowerCase().startsWith(make.toLowerCase())
      ? model
      : `${make} ${model}`
  }
  return make ?? model ?? ''
}

// 예 "4032 × 3024 · 2.3MB · HEIC". 형식은 파일 확장자, 없으면 MIME.
function fileText(asset: Asset, lng: string): string {
  const mb = asset.size_bytes / 1_000_000
  const size = new Intl.NumberFormat(lng, {
    style: 'unit',
    unit: mb >= 1 ? 'megabyte' : 'kilobyte',
    maximumFractionDigits: 1,
  }).format(mb >= 1 ? mb : asset.size_bytes / 1000)
  const dot = asset.original_filename.lastIndexOf('.')
  const format =
    dot > 0
      ? asset.original_filename.slice(dot + 1).toUpperCase()
      : (asset.mime.split('/')[1]?.toUpperCase() ?? '')
  return [
    asset.width && asset.height
      ? `${String(asset.width)} × ${String(asset.height)}`
      : '',
    size,
    format,
  ]
    .filter(Boolean)
    .join(' · ')
}

// 편집 종료 시 편집 버튼으로 포커스 복귀.
function Section({
  title,
  editLabel,
  onEdit,
  editing = false,
  children,
}: {
  title: string
  editLabel?: string
  onEdit?: () => void
  editing?: boolean
  children: ReactNode
}) {
  const { t } = useTranslation()
  const button = useRef<HTMLButtonElement>(null)
  const wasEditing = useRef(editing)
  useEffect(() => {
    if (wasEditing.current && !editing) button.current?.focus()
    wasEditing.current = editing
  }, [editing])
  return (
    <section className="grid gap-1">
      <div className="flex min-h-8 items-center justify-between gap-2">
        <h3 className="text-sm text-muted-foreground">{title}</h3>
        {onEdit && !editing && (
          <Button
            ref={button}
            variant="ghost"
            size="sm"
            aria-label={editLabel}
            onClick={onEdit}
          >
            <IconEdit aria-hidden />
            {t('viewer.edit')}
          </Button>
        )}
      </div>
      {children}
    </section>
  )
}

function CaptionEditor({
  asset,
  onDone,
}: {
  asset: Asset
  onDone: () => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [value, setValue] = useState(asset.caption ?? '')
  // 앞뒤 공백 정리·빈 값 비움은 서버.
  const save = useMutation({
    mutationFn: (caption: string) =>
      call(
        api.PATCH('/api/assets/{id}', {
          params: { path: { id: asset.id } },
          body: { caption },
        }),
      ),
    // 목록 항목(AssetSummary)에 caption 없음. 상세만 교체, 목록 재조회 안 함.
    onSuccess: (a) => {
      qc.setQueryData(assetKey(a.id), a)
      onDone()
    },
  })
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate(value)
      }}
    >
      <Textarea
        aria-label={t('viewer.caption')}
        value={value}
        maxLength={2000}
        onChange={(e) => {
          setValue(e.target.value)
        }}
        autoFocus
      />
      <FormError error={save.error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={save.isPending}>
          {t('common.save')}
        </Button>
        <Button type="button" variant="outline" onClick={onDone}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  )
}

function BabyTagsEditor({
  asset,
  babies,
  onDone,
}: {
  asset: Asset
  babies: Baby[]
  onDone: () => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const idPrefix = useId()
  const [selected, setSelected] = useState(() => new Set(asset.baby_ids))
  const save = useMutation({
    mutationFn: (babyIds: string[]) =>
      call(
        api.PUT('/api/assets/{id}/babies', {
          params: { path: { id: asset.id } },
          body: { baby_ids: babyIds },
        }),
      ),
    onSuccess: (a) => {
      applyAsset(qc, a)
      onDone()
    },
  })
  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        // 아기 표시 순서 유지.
        save.mutate(babies.filter((b) => selected.has(b.id)).map((b) => b.id))
      }}
    >
      <fieldset className="grid gap-3">
        <legend className="sr-only">{t('viewer.babies')}</legend>
        {babies.map((b) => (
          <div key={b.id} className="flex items-center gap-2">
            <Checkbox
              id={`${idPrefix}-${b.id}`}
              checked={selected.has(b.id)}
              onCheckedChange={(c) => {
                toggle(b.id, c === true)
              }}
            />
            <Label htmlFor={`${idPrefix}-${b.id}`}>{b.name}</Label>
          </div>
        ))}
      </fieldset>
      <FormError error={save.error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={save.isPending}>
          {t('common.save')}
        </Button>
        <Button type="button" variant="outline" onClick={onDone}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  )
}

// 아기 정보 전체 교체 API. 기존 필드 유지하고 대표사진만 변경.
function AvatarDialog({ asset, babies }: { asset: Asset; babies: Baby[] }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const set = useMutation({
    mutationFn: (b: Baby) =>
      call(
        api.PUT('/api/babies/{id}', {
          params: { path: { id: b.id } },
          body: {
            name: b.name,
            birth_date: b.birth_date,
            sex: b.sex,
            avatar_asset_id: asset.id,
            avatar_crop: null,
          },
        }),
      ),
    onSuccess: (b) => {
      void qc.invalidateQueries({ queryKey: babiesKey })
      toast(t('viewer.avatarSet', { name: b.name }))
      setOpen(false)
    },
  })
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) set.reset()
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">{t('viewer.setAvatar')}</Button>
      </DialogTrigger>
      <DialogContent
        aria-describedby={undefined}
        className="dark text-foreground"
      >
        <DialogHeader>
          <DialogTitle>{t('viewer.setAvatarTitle')}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-2">
          {babies.map((b) => (
            <Button
              key={b.id}
              variant="outline"
              disabled={set.isPending}
              onClick={() => {
                set.mutate(b)
              }}
            >
              {b.name}
            </Button>
          ))}
        </div>
        <FormError error={set.error} />
      </DialogContent>
    </Dialog>
  )
}

// 정보 패널 내용. 편집은 guardian 이상. 편집 상태는 뷰어 소유(더 보기 메뉴의 촬영일 고치기).
export function InfoPanel({
  asset,
  canEdit,
  editing,
  onEditingChange,
  onRetry,
  retrying,
  retryError,
}: {
  asset: Asset
  canEdit: boolean
  editing: Editing | null
  onEditingChange: (editing: Editing | null) => void
  onRetry: (() => void) | undefined
  retrying: boolean
  retryError: unknown
}) {
  const { t, i18n } = useTranslation()
  const tz = useSettings()?.timezone
  const babies = useBabies().data ?? []
  const uploader = useUsers().data?.users.find(
    (u) => u.id === asset.uploaded_by,
  )

  function editProps(kind: Editing, label: string) {
    if (!canEdit) return {}
    return {
      editLabel: label,
      editing: editing === kind,
      onEdit: () => {
        onEditingChange(kind)
      },
    }
  }
  const done = () => {
    onEditingChange(null)
  }

  const tagged = babies.filter((b) => asset.baby_ids.includes(b.id))
  const camera = cameraText(asset.camera_make, asset.camera_model)
  const canSetAvatar =
    canEdit &&
    asset.kind === 'photo' &&
    asset.status === 'ready' &&
    babies.length > 0

  return (
    <div className="grid gap-5 px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
      {asset.status === 'failed' && (
        <section className="grid justify-items-start gap-2">
          <p>{t('viewer.failed')}</p>
          {/* 서버 원문. 언어 혼재 가능. */}
          {asset.processing_error && (
            <p className="text-sm break-words text-muted-foreground">
              {asset.processing_error}
            </p>
          )}
          {onRetry && (
            <Button variant="outline" disabled={retrying} onClick={onRetry}>
              {t('viewer.retry')}
            </Button>
          )}
          <FormError error={retryError} />
        </section>
      )}

      <Section
        title={t('viewer.caption')}
        {...editProps('caption', t('viewer.editCaption'))}
      >
        {editing === 'caption' ? (
          <CaptionEditor asset={asset} onDone={done} />
        ) : asset.caption ? (
          <p className="break-words whitespace-pre-wrap">{asset.caption}</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t('viewer.noCaption')}
          </p>
        )}
      </Section>

      <Section
        title={t('viewer.takenAt')}
        {...(tz ? editProps('takenAt', t('viewer.editTakenAt')) : {})}
      >
        {tz && editing === 'takenAt' ? (
          <TakenAtEditor asset={asset} tz={tz} onDone={done} />
        ) : (
          <>
            {tz && (
              <p className="tabular-nums">
                {formatInZone(asset.taken_at, tz, i18n.language)}
              </p>
            )}
            {!DEVICE_SOURCES.has(asset.taken_at_source) && (
              <p className="text-sm text-muted-foreground">
                {t('viewer.sourceLabel')}:{' '}
                {t(`viewer.source.${asset.taken_at_source}`)}
              </p>
            )}
          </>
        )}
      </Section>

      <Section
        title={t('viewer.babies')}
        {...(babies.length > 0
          ? editProps('babies', t('viewer.editBabies'))
          : {})}
      >
        {editing === 'babies' ? (
          <BabyTagsEditor asset={asset} babies={babies} onDone={done} />
        ) : tagged.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {tagged.map((b) => (
              <li
                key={b.id}
                className="rounded-full bg-secondary px-3 py-0.5 text-sm"
              >
                {b.name}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t('viewer.noBabies')}
          </p>
        )}
      </Section>

      <Section title={t('viewer.uploadedBy')}>
        {/* 모르는 사용자(목록 미로드·오프라인)는 시각만. */}
        {uploader && <p className="wrap-anywhere">{uploader.display_name}</p>}
        {tz && (
          <p className="text-sm text-muted-foreground tabular-nums">
            {formatInZone(asset.created_at, tz, i18n.language)}
          </p>
        )}
      </Section>

      <Section title={t('viewer.file')}>
        <p className="tabular-nums">{fileText(asset, i18n.language)}</p>
      </Section>

      {camera && (
        <Section title={t('viewer.camera')}>
          <p>{camera}</p>
        </Section>
      )}

      {canSetAvatar && (
        <div className="flex flex-wrap gap-2">
          <AvatarDialog asset={asset} babies={babies} />
        </div>
      )}
    </div>
  )
}
