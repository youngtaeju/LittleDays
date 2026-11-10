import IconClose from '~icons/material-symbols/close-rounded'
import IconVideo from '~icons/material-symbols/videocam-outline-rounded'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useBabies } from '@/timeline/useBabies'
import { AdaptiveSheet } from './AdaptiveSheet'
import { extension, isHeif, mediaKind } from './fileKind'
import { loadLastBabies, saveLastBabies } from './lastBabies'

import type { PendingFile } from './picker'

// 미리보기 칸. 주소는 화면에 있는 동안만 유지(닫기·빼기·올리기 때 해제).
function Preview({ file }: { file: File }) {
  const kind = mediaKind(file)
  // HEIC 는 대부분 브라우저가 못 그림. 그 밖은 시도 후 실패 시 형식 표시.
  const [failed, setFailed] = useState(isHeif(file))
  const ref = useRef<HTMLImageElement & HTMLVideoElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const url = URL.createObjectURL(file)
    // 영상 첫 장면 표시(iOS 는 0초 프레임을 그리지 않음).
    el.src = kind === 'video' ? `${url}#t=0.1` : url
    return () => {
      URL.revokeObjectURL(url)
    }
  }, [file, kind])

  const label =
    extension(file.name).toUpperCase() ||
    file.type.split('/')[1]?.toUpperCase() ||
    '?'
  const onError = () => {
    setFailed(true)
  }
  return (
    <div className="relative size-full bg-muted">
      {failed ? (
        <span className="grid size-full place-items-center text-2xs font-semibold text-muted-foreground">
          {label}
        </span>
      ) : kind === 'video' ? (
        <video
          ref={ref}
          muted
          playsInline
          preload="metadata"
          onError={onError}
          className="size-full object-cover"
        />
      ) : (
        <img
          ref={ref}
          alt=""
          loading="lazy"
          decoding="async"
          onError={onError}
          className="size-full object-cover"
        />
      )}
      {kind === 'video' && (
        <IconVideo
          aria-hidden
          className="absolute bottom-1 left-1 size-4 text-white drop-shadow"
        />
      )}
    </div>
  )
}

function BabyPicker({
  babies,
  selected,
  onToggle,
}: {
  babies: { id: string; name: string }[]
  selected: readonly string[]
  onToggle: (id: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div role="group" aria-label={t('upload.babies')} className="grid gap-1">
      <p aria-hidden className="text-xs text-muted-foreground">
        {t('upload.babies')}
      </p>
      <div className="flex flex-wrap gap-x-2">
        {babies.map((b) => {
          const on = selected.includes(b.id)
          return (
            // 터치 영역 44px, 보이는 칩은 그 안.
            <button
              key={b.id}
              type="button"
              aria-pressed={on}
              onClick={() => {
                onToggle(b.id)
              }}
              className="flex h-11 max-w-48 items-center rounded-full"
            >
              <span
                className={cn(
                  'truncate rounded-full px-3 py-1 text-sm',
                  on
                    ? 'bg-primary font-semibold text-primary-foreground'
                    : 'bg-muted',
                )}
              >
                {b.name}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// 고른 파일 확인. 아기 1명이면 자동 태그(줄 숨김), 2명 이상이면 지난 선택이 기본값.
export function UploadConfirm({
  files,
  onRemove,
  onCancel,
  onSubmit,
}: {
  files: readonly PendingFile[]
  onRemove: (key: number) => void
  onCancel: () => void
  onSubmit: (files: File[], babyIds: string[]) => void
}) {
  const { t } = useTranslation()
  const babiesQuery = useBabies()
  const babies = babiesQuery.data ?? []
  const many = babies.length > 1
  const [picked, setPicked] = useState<readonly string[] | null>(null)
  // 실수로 Enter 를 눌러도 항목이 빠지지 않도록 올리기에 첫 포커스.
  const submitRef = useRef<HTMLButtonElement>(null)
  // 아기 표시 순서. 지운 아기 제외.
  const chosen = new Set(
    picked ??
      (many
        ? loadLastBabies(babies.map((b) => b.id))
        : babies.map((b) => b.id)),
  )
  const babyIds = babies.filter((b) => chosen.has(b.id)).map((b) => b.id)

  const photos = files.filter((f) => mediaKind(f.file) === 'photo').length
  const videos = files.length - photos
  const items = [
    photos > 0 ? t('feed.photos', { count: photos }) : null,
    videos > 0 ? t('feed.videos', { count: videos }) : null,
  ]
    .filter(Boolean)
    .join(' · ')

  function toggle(id: string) {
    setPicked(
      chosen.has(id) ? babyIds.filter((x) => x !== id) : [...babyIds, id],
    )
  }

  function submit() {
    if (many) saveLastBabies(babyIds)
    onSubmit(
      files.map((f) => f.file),
      babyIds,
    )
  }

  return (
    <AdaptiveSheet
      title={t('upload.confirmTitle', { items })}
      onClose={onCancel}
      showCloseButton={false}
      initialFocus={submitRef}
    >
      <div className="grid gap-4">
        <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pt-1 lg:mx-0 lg:px-0">
          {files.map(({ key, file }) => (
            <li key={key} className="relative size-24 shrink-0">
              <Preview file={file} />
              <button
                type="button"
                aria-label={t('upload.remove', { name: file.name })}
                onClick={() => {
                  onRemove(key)
                }}
                className="absolute -top-1 -right-1 grid size-11 place-items-center"
              >
                <span className="grid size-6 place-items-center rounded-full bg-foreground/70 text-background">
                  <IconClose aria-hidden className="size-4" />
                </span>
              </button>
            </li>
          ))}
        </ul>
        {many && (
          <BabyPicker babies={babies} selected={babyIds} onToggle={toggle} />
        )}
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          {/* 아기 목록 전에 올리면 기본 태그 누락. */}
          <Button
            ref={submitRef}
            className="flex-1"
            disabled={babiesQuery.isPending}
            onClick={submit}
          >
            {t('upload.submit')}
          </Button>
        </div>
      </div>
    </AdaptiveSheet>
  )
}
