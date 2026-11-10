import { useMutation, useQueryClient } from '@tanstack/react-query'
import IconBack from '~icons/material-symbols/arrow-back-rounded'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { api, call } from '@/api/client'
import type { Baby } from '@/api/types'
import { FormError } from '@/components/Field'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/i18n'
import { Tile } from '@/timeline/Tile'
import { useTimeline } from '@/timeline/useTimeline'
import { mediaKind } from '@/upload/fileKind'
import { useUploadStore } from '@/upload/useUploadStore'
import { applyAsset, useAsset } from '@/viewer/useAsset'
import { AvatarCropper, CROP_VIEW_PX } from './AvatarCropper'
import { Avatar } from './Avatar'
import { centerCrop, clampCrop, type AvatarCrop } from './crop'

export interface AvatarValue {
  assetId: string | null
  crop: AvatarCrop | null
}

// 폼 대신 보이는 하위 화면. 없으면 폼의 대표 사진 영역.
export type PickStep =
  | { kind: 'ours' }
  | { kind: 'upload'; itemId: string; file: File }
  | {
      kind: 'crop'
      assetId: string
      crop: AvatarCrop | null
      fromOurs: boolean
    }

type Trigger = 'ours' | 'device' | 'adjust'

// HEIC 는 MIME 을 비워 보내는 브라우저 대응.
const IMAGE_ACCEPT = 'image/*,.heic,.heif'

function StepLayout({
  title,
  onBack,
  footer,
  children,
}: {
  title: string
  onBack: () => void
  footer?: ReactNode
  children: ReactNode
}) {
  const { t } = useTranslation()
  // 하위 화면 전환 시 제목으로 포커스(스크린리더가 새 화면 안내).
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    heading.current?.focus()
  }, [])
  return (
    <section aria-label={title} className="grid gap-4">
      <div className="-ml-2 flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('babies.back')}
          onClick={onBack}
        >
          <IconBack aria-hidden className="size-6" />
        </Button>
        <h3
          ref={heading}
          tabIndex={-1}
          className="text-base font-bold outline-none"
        >
          {title}
        </h3>
      </div>
      {children}
      {footer}
    </section>
  )
}

function CircleFrame({ children }: { children?: ReactNode }) {
  return (
    <div
      className="relative mx-auto overflow-hidden rounded-full bg-muted"
      style={{ width: CROP_VIEW_PX, height: CROP_VIEW_PX }}
    >
      {children}
    </div>
  )
}

// 처리 전 로컬 미리보기. 브라우저가 못 그리는 형식(HEIC 등)은 빈 원.
function LocalPreview({ file }: { file: File }) {
  const ref = useRef<HTMLImageElement>(null)
  const [broken, setBroken] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const url = URL.createObjectURL(file)
    el.src = url
    return () => {
      URL.revokeObjectURL(url)
    }
  }, [file])
  return (
    <CircleFrame>
      {!broken && (
        <img
          ref={ref}
          alt=""
          className="size-full object-cover"
          onError={() => {
            setBroken(true)
          }}
        />
      )}
    </CircleFrame>
  )
}

// 이 아기 태그 사진 중 처리 끝난 사진. 영상·처리 중·실패 제외.
function OurPhotos({
  babyId,
  onSelect,
  onBack,
}: {
  babyId: string
  onSelect: (id: string) => void
  onBack: () => void
}) {
  const { t } = useTranslation()
  const {
    items,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    isLoadingError,
    status,
    error,
    refetch,
  } = useTimeline(babyId)
  const photos = useMemo(
    () => items.filter((i) => i.kind === 'photo' && i.status === 'ready'),
    [items],
  )

  // 시트 안 스크롤. 보이면 다음 페이지, 실패 시 버튼.
  const sentinel = useRef<HTMLDivElement>(null)
  const autoLoad = hasNextPage && !isFetchingNextPage && !isFetchNextPageError
  useEffect(() => {
    const el = sentinel.current
    if (!el || !autoLoad) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void fetchNextPage()
    })
    io.observe(el)
    return () => {
      io.disconnect()
    }
  }, [autoLoad, fetchNextPage])

  return (
    <StepLayout title={t('babies.pickOurs')} onBack={onBack}>
      {status === 'pending' && (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      )}
      {isLoadingError && (
        <div className="grid justify-items-start gap-3">
          <p className="text-sm">{errorMessage(t, error)}</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => void refetch()}
          >
            {t('common.retry')}
          </Button>
        </div>
      )}
      {status === 'success' && photos.length === 0 && !hasNextPage && (
        <p className="text-sm text-muted-foreground">{t('babies.noPhotos')}</p>
      )}
      <ul
        aria-label={t('babies.pickOurs')}
        className="-mx-4 grid grid-cols-3 gap-[2px] sm:grid-cols-4"
      >
        {photos.map((p) => (
          <li key={p.id}>
            <Tile item={p} onSelect={onSelect} />
          </li>
        ))}
      </ul>
      <div ref={sentinel} />
      {isFetchingNextPage && (
        <p className="text-center text-sm text-muted-foreground">
          {t('common.loading')}
        </p>
      )}
      {isFetchNextPageError && (
        <div className="grid justify-items-center gap-3">
          <p className="text-sm">{errorMessage(t, error)}</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => void fetchNextPage()}
          >
            {t('common.retry')}
          </Button>
        </div>
      )}
    </StepLayout>
  )
}

// 자르기. 처리 중이면 폴링(useAsset)하며 미리보기(fallback) 표시, 정하기 막음.
// tagBabyId: 이 아기 태그가 없을 수 있는 자산(업로드 중복). 정하기 전에 태그 추가.
function CropStep({
  assetId,
  initial,
  fallback,
  tagBabyId,
  onBack,
  onDone,
}: {
  assetId: string
  initial: AvatarCrop | null
  fallback?: ReactNode
  tagBabyId?: string
  onBack: () => void
  onDone: (value: AvatarValue) => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const asset = useAsset(assetId)
  // 최신 태그 기준으로 추가(캐시의 옛 목록으로 다른 아기 태그를 지우지 않게).
  const tag = useMutation({
    mutationFn: async (babyId: string) => {
      const path = { params: { path: { id: assetId } } }
      const current = await call(api.GET('/api/assets/{id}', path))
      if (current.baby_ids.includes(babyId)) return
      applyAsset(
        qc,
        await call(
          api.PUT('/api/assets/{id}/babies', {
            ...path,
            body: { baby_ids: [...current.baby_ids, babyId] },
          }),
        ),
      )
    },
  })
  const [crop, setCrop] = useState(initial)
  const a = asset.data
  const w = a?.status === 'ready' && a.kind === 'photo' ? a.width : null
  const h = a?.status === 'ready' && a.kind === 'photo' ? a.height : null
  const value = w && h ? clampCrop(crop ?? centerCrop(w, h), w, h) : null

  let body: ReactNode
  if (value && w && h) {
    body = (
      <AvatarCropper
        assetId={assetId}
        width={w}
        height={h}
        crop={value}
        onChange={setCrop}
      />
    )
  } else if (asset.isError) {
    body = (
      <div className="grid justify-items-center gap-3">
        <p role="alert" className="text-sm">
          {errorMessage(t, asset.error)}
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={() => void asset.refetch()}
        >
          {t('common.retry')}
        </Button>
      </div>
    )
  } else if (!a || a.status === 'processing') {
    body = (
      <>
        {fallback ?? <CircleFrame />}
        {a && (
          <p className="text-center text-sm text-muted-foreground">
            {t('babies.avatarProcessing')}
          </p>
        )}
      </>
    )
  } else {
    body = (
      <p role="alert" className="text-sm text-destructive">
        {a.kind === 'video' ? t('babies.photoOnly') : t('babies.avatarFailed')}
      </p>
    )
  }

  return (
    <StepLayout
      title={t('babies.adjustAvatar')}
      onBack={onBack}
      footer={
        <>
          <FormError error={tag.error} />
          <Button
            type="button"
            disabled={!value || tag.isPending}
            onClick={() => {
              if (!value) return
              if (!tagBabyId) {
                onDone({ assetId, crop: value })
                return
              }
              tag.mutate(tagBabyId, {
                onSuccess: () => {
                  onDone({ assetId, crop: value })
                },
              })
            }}
          >
            {t('babies.useCrop')}
          </Button>
        </>
      }
    >
      {body}
    </StepLayout>
  )
}

// 기기에서 올린 파일. 업로드 목록 항목이 자산(done·duplicate)이 되면 자르기로.
function UploadStep({
  babyId,
  itemId,
  file,
  onBack,
  onRepick,
  onDone,
}: {
  babyId: string
  itemId: string
  file: File
  onBack: () => void
  onRepick: () => void
  onDone: (value: AvatarValue) => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const item = useUploadStore().find((i) => i.id === itemId)
  const assetId =
    item?.status === 'done' ||
    (item?.status === 'duplicate' && (!item.inTrash || item.restored))
      ? item.assetId
      : undefined

  if (assetId) {
    return (
      <CropStep
        key={assetId}
        assetId={assetId}
        initial={null}
        fallback={<LocalPreview file={file} />}
        tagBabyId={item?.status === 'duplicate' ? babyId : undefined}
        onBack={onBack}
        onDone={onDone}
      />
    )
  }

  const failure = !item
    ? t('errors.unknown')
    : item.status === 'duplicate'
      ? t('babies.avatarInTrash')
      : item.status === 'error'
        ? errorMessage(t, item.error)
        : item.status === 'lost' || item.status === 'unsupported'
          ? t(`upload.status.${item.status}`)
          : null
  const canRetry = item?.status === 'error' || item?.status === 'lost'

  return (
    <StepLayout
      title={t('babies.adjustAvatar')}
      onBack={onBack}
      footer={
        <Button type="button" disabled>
          {t('babies.useCrop')}
        </Button>
      }
    >
      <LocalPreview file={file} />
      {failure ? (
        <div className="grid justify-items-center gap-3">
          <p role="alert" className="text-center text-sm text-destructive">
            {failure}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {canRetry && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void import('@/upload/uploader').then(({ getUploader }) => {
                    getUploader(qc).retry(itemId)
                  })
                }}
              >
                {t('common.retry')}
              </Button>
            )}
            <Button type="button" variant="outline" onClick={onRepick}>
              {t('babies.pickAnother')}
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-center text-sm text-muted-foreground">
          {t('babies.avatarUploading')}
        </p>
      )}
    </StepLayout>
  )
}

// 아기 정보 시트의 대표 사진 영역과 하위 화면(우리 사진 고르기, 기기에서 올리기, 자르기).
// 고른 값은 폼 저장 때 PUT. 하위 화면 동안 폼은 부모가 숨김.
export function AvatarPicker({
  baby,
  value,
  onChange,
  step,
  onStepChange,
}: {
  baby: Baby
  value: AvatarValue
  onChange: (value: AvatarValue) => void
  step: PickStep | null
  onStepChange: (step: PickStep | null) => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [pickError, setPickError] = useState<string | null>(null)
  // 폼으로 돌아오면 하위 화면을 연 버튼으로 포커스.
  const triggers = useRef<Partial<Record<Trigger, HTMLButtonElement | null>>>(
    {},
  )
  const opener = useRef<Trigger>('ours')
  const wasOpen = useRef(step !== null)
  useEffect(() => {
    if (wasOpen.current && !step) {
      ;(triggers.current[opener.current] ?? triggers.current.ours)?.focus()
    }
    wasOpen.current = step !== null
  }, [step])

  // Tile memo 유지용 고정 콜백.
  const pickOurs = useCallback(
    (assetId: string) => {
      onStepChange({ kind: 'crop', assetId, crop: null, fromOurs: true })
    },
    [onStepChange],
  )

  function done(next: AvatarValue) {
    onChange(next)
    onStepChange(null)
  }

  // 일반 업로드(이 아기 태그, 타임라인에도 들어감). Uppy 는 지연 로딩.
  async function upload(file: File) {
    setPickError(null)
    if (mediaKind(file) !== 'photo') {
      setPickError(t('babies.photoOnly'))
      return
    }
    try {
      const { getUploader } = await import('@/upload/uploader')
      const [itemId] = getUploader(qc).add([file], [baby.id])
      if (itemId) onStepChange({ kind: 'upload', itemId, file })
    } catch {
      setPickError(t('errors.unknown'))
    }
  }

  let content: ReactNode
  if (step?.kind === 'ours') {
    content = (
      <OurPhotos
        babyId={baby.id}
        onSelect={pickOurs}
        onBack={() => {
          onStepChange(null)
        }}
      />
    )
  } else if (step?.kind === 'upload') {
    content = (
      <UploadStep
        key={step.itemId}
        babyId={baby.id}
        itemId={step.itemId}
        file={step.file}
        onBack={() => {
          onStepChange(null)
        }}
        onRepick={() => input.current?.click()}
        onDone={done}
      />
    )
  } else if (step?.kind === 'crop') {
    content = (
      <CropStep
        key={step.assetId}
        assetId={step.assetId}
        initial={step.crop}
        onBack={() => {
          onStepChange(step.fromOurs ? { kind: 'ours' } : null)
        }}
        onDone={done}
      />
    )
  } else {
    const assetId = value.assetId
    content = (
      <fieldset className="grid gap-3">
        <legend className="mb-2 text-sm font-semibold">
          {t('babies.avatar')}
        </legend>
        <Avatar
          baby={{ ...baby, avatar_asset_id: assetId, avatar_crop: value.crop }}
          size={72}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            ref={(el) => {
              triggers.current.ours = el
            }}
            type="button"
            variant="outline"
            onClick={() => {
              setPickError(null)
              opener.current = 'ours'
              onStepChange({ kind: 'ours' })
            }}
          >
            {t('babies.pickOurs')}
          </Button>
          <Button
            ref={(el) => {
              triggers.current.device = el
            }}
            type="button"
            variant="outline"
            onClick={() => {
              opener.current = 'device'
              input.current?.click()
            }}
          >
            {t('babies.pickDevice')}
          </Button>
          {assetId && (
            <>
              <Button
                ref={(el) => {
                  triggers.current.adjust = el
                }}
                type="button"
                variant="outline"
                onClick={() => {
                  opener.current = 'adjust'
                  onStepChange({
                    kind: 'crop',
                    assetId,
                    crop: value.crop,
                    fromOurs: false,
                  })
                }}
              >
                {t('babies.adjustAvatar')}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="text-destructive"
                onClick={() => {
                  onChange({ assetId: null, crop: null })
                }}
              >
                {t('babies.removeAvatar')}
              </Button>
            </>
          )}
        </div>
      </fieldset>
    )
  }

  return (
    <div className="grid gap-3">
      <input
        ref={input}
        type="file"
        accept={IMAGE_ACCEPT}
        className="hidden"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.currentTarget.files?.[0]
          // 같은 파일 다시 선택 허용.
          e.currentTarget.value = ''
          if (file) void upload(file)
        }}
      />
      {content}
      {pickError && (
        <p role="alert" className="text-sm text-destructive">
          {pickError}
        </p>
      )}
    </div>
  )
}
