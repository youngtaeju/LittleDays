import type { QueryClient } from '@tanstack/react-query'
import IconAddPhoto from '~icons/material-symbols/add-a-photo-outline-rounded'
import IconPhotos from '~icons/material-symbols/photo-library-outline-rounded'
import { useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { AssetSummary, AttachTarget } from '@/api/types'
import { Button } from '@/components/ui/button'
import { mediaKind } from '@/upload/fileKind'
import { ACCEPTED_FILE_TYPES } from '@/upload/useUploadStore'
import { AssetPickerSheet } from './AssetPickerSheet'
import { PhotoStrip, type StripItem } from './PhotoStrip'

export function assetItem(asset: AssetSummary): StripItem {
  return { key: `a:${asset.id}`, kind: 'asset', asset }
}

export function assetIds(items: readonly StripItem[]): string[] {
  return items.flatMap((i) => (i.kind === 'asset' ? [i.asset.id] : []))
}

export function stripFiles(items: readonly StripItem[]): File[] {
  return items.flatMap((i) => (i.kind === 'file' ? [i.file] : []))
}

export function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

// 바꾼 사진 목록 + 그사이 백그라운드 업로드로 붙은 사진(처음 목록에도 지금 목록에도 없는 서버 연결)은 뒤에 보존.
export function keepServerOnly(
  ids: readonly string[],
  base: readonly string[],
  fresh: readonly AssetSummary[],
): string[] {
  const added = fresh
    .map((a) => a.id)
    .filter((id) => !base.includes(id) && !ids.includes(id))
  return [...ids, ...added]
}

function move<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list]
  const [x] = next.splice(from, 1)
  if (x !== undefined) next.splice(to, 0, x)
  return next
}

// 업로드 큐는 지연 로딩. 실패 시 대상은 저장된 채 호출 측이 안내.
export async function queueFiles(
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

// 이야기, 마일스톤 공용 사진 칸. 고른 사진 가로 띠, "올린 사진에서 고르기", "새로 올리기".
// date: 고르기 시트에서 먼저 보일 날. hint: 새 파일이 있을 때 안내.
export function PhotoField({
  items,
  onChange,
  date,
  hint,
}: {
  items: readonly StripItem[]
  onChange: Dispatch<SetStateAction<StripItem[]>>
  date: string | undefined
  hint: string
}) {
  const { t } = useTranslation()
  const [picking, setPicking] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const nextKey = useRef(0)
  const hasFiles = items.some((i) => i.kind === 'file')

  function addFiles(list: File[]) {
    const media = list.filter((f) => mediaKind(f) !== null)
    if (media.length < list.length) toast.error(t('upload.status.unsupported'))
    if (media.length === 0) return
    const added = media.map((file): StripItem => ({
      key: `f:${String(nextKey.current++)}`,
      kind: 'file',
      file,
    }))
    onChange((prev) => [...prev, ...added])
  }

  // 고른 결과로 교체. 빠진 사진은 제거, 새로 고른 사진은 맨 뒤. 기기 파일은 그대로.
  function applyPicked(assets: AssetSummary[]) {
    const keep = new Set(assets.map((a) => a.id))
    onChange((prev) => {
      const kept = prev.filter((i) => i.kind === 'file' || keep.has(i.asset.id))
      const have = new Set(assetIds(kept))
      return [...kept, ...assets.filter((a) => !have.has(a.id)).map(assetItem)]
    })
    setPicking(false)
  }

  return (
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
              onChange((prev) => prev.filter((i) => i.key !== key))
            }}
            onReorder={(key, to) => {
              onChange((prev) => {
                const from = prev.findIndex((i) => i.key === key)
                return from < 0 ? prev : move(prev, from, to)
              })
            }}
          />
        </>
      )}
      <Button
        type="button"
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
        type="button"
        variant="outline"
        className="h-12 text-[15px] font-semibold"
        onClick={() => {
          fileInput.current?.click()
        }}
      >
        <IconAddPhoto aria-hidden className="size-5" />
        {t('stories.uploadNew')}
      </Button>
      {hasFiles && <p className="text-xs text-muted-foreground">{hint}</p>}
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
      {picking && (
        <AssetPickerSheet
          date={date}
          selected={items.flatMap((i) => (i.kind === 'asset' ? [i.asset] : []))}
          onDone={applyPicked}
          onClose={() => {
            setPicking(false)
          }}
        />
      )}
    </section>
  )
}
