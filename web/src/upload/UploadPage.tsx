import { useQueryClient } from '@tanstack/react-query'
import { Upload } from 'lucide-react'
import { useEffect, useId, useRef, useState, type DragEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { useBabies } from '@/timeline/useBabies'
import type { Uploader } from './uploader'
import { UploadQueue } from './UploadQueue'
import { ACCEPTED_FILE_TYPES, useUploadStore } from './useUploadStore'

// Uppy 는 업로드 화면 첫 진입 때 지연 로딩. 인스턴스는 모듈 단위 단일.
function useUploader(): Uploader | 'failed' | null {
  const qc = useQueryClient()
  const [uploader, setUploader] = useState<Uploader | 'failed' | null>(null)
  useEffect(() => {
    let alive = true
    import('./uploader').then(
      (m) => {
        if (alive) setUploader(m.getUploader(qc))
      },
      () => {
        if (alive) setUploader('failed')
      },
    )
    return () => {
      alive = false
    }
  }, [qc])
  return uploader
}

// 드롭 영역 밖에 떨어뜨린 파일로 브라우저가 페이지를 떠나지 않도록 차단.
function useBlockStrayDrop(): void {
  useEffect(() => {
    const block = (e: Event) => {
      e.preventDefault()
    }
    window.addEventListener('dragover', block)
    window.addEventListener('drop', block)
    return () => {
      window.removeEventListener('dragover', block)
      window.removeEventListener('drop', block)
    }
  }, [])
}

export function UploadPage() {
  const { t } = useTranslation()
  const uploader = useUploader()
  useBlockStrayDrop()
  const items = useUploadStore()
  const babiesQuery = useBabies()
  const babies = babiesQuery.data ?? []
  const [picked, setPicked] = useState<string[] | null>(null)
  // 기본: 아기가 1명이면 그 아기, 여럿이면 선택 없음. 삭제된 아기 제외.
  const babyIds = (
    picked ?? (babies.length === 1 ? babies.map((b) => b.id) : [])
  ).filter((id) => babies.some((b) => b.id === id))
  const inputRef = useRef<HTMLInputElement>(null)
  const idPrefix = useId()
  const [dragging, setDragging] = useState(false)
  // 아기 목록 전에 올리면 기본 태그 누락.
  const ready =
    uploader !== null && uploader !== 'failed' && !babiesQuery.isPending
      ? uploader
      : null

  function addFiles(files: FileList | null) {
    if (!ready || !files || files.length === 0) return
    ready.add([...files], babyIds)
  }

  function toggle(id: string, on: boolean) {
    setPicked(on ? [...babyIds, id] : babyIds.filter((x) => x !== id))
  }

  // 준비 전에도 기본 동작(파일 열기) 차단.
  function onDragOver(e: DragEvent) {
    e.preventDefault()
    if (ready) setDragging(true)
  }

  function onDragLeave(e: DragEvent) {
    // 자식 요소 사이 이동은 무시.
    if (
      e.relatedTarget instanceof Node &&
      e.currentTarget.contains(e.relatedTarget)
    ) {
      return
    }
    setDragging(false)
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    addFiles(e.dataTransfer.files)
  }

  return (
    <div className="mx-auto grid max-w-2xl gap-6">
      <h1 className="text-xl font-semibold">{t('nav.upload')}</h1>
      {babies.length > 0 && (
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-semibold">
            {t('upload.babies')}
          </legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {babies.map((b) => (
              <div key={b.id} className="flex items-center gap-2">
                <Checkbox
                  id={`${idPrefix}-${b.id}`}
                  checked={babyIds.includes(b.id)}
                  onCheckedChange={(v) => {
                    toggle(b.id, v === true)
                  }}
                />
                <Label htmlFor={`${idPrefix}-${b.id}`}>{b.name}</Label>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {t('upload.babiesHint')}
          </p>
        </fieldset>
      )}
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={cn(
          'grid place-items-center gap-3 rounded-md border-2 border-dashed border-border p-6 text-center',
          dragging && 'border-primary',
        )}
      >
        <Button disabled={!ready} onClick={() => inputRef.current?.click()}>
          <Upload aria-hidden />
          {t('upload.choose')}
        </Button>
        <p className="hidden text-sm text-muted-foreground lg:block">
          {t('upload.drop')}
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_FILE_TYPES.join(',')}
          className="hidden"
          onChange={(e) => {
            addFiles(e.currentTarget.files)
            // 같은 파일 다시 선택(이어 올리기·다시 올리기) 허용.
            e.currentTarget.value = ''
          }}
        />
      </div>
      {uploader === 'failed' && (
        <p role="alert" className="text-sm text-destructive">
          {t('errors.unknown')}
        </p>
      )}
      {items.length > 0 && <UploadQueue items={items} retry={ready?.retry} />}
    </div>
  )
}
