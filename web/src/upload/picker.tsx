import { useQueryClient } from '@tanstack/react-query'
import {
  Suspense,
  createContext,
  lazy,
  use,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { hasRole, useMe } from '@/auth/session'
import { babiesQuery } from '@/timeline/useBabies'
import { mediaKind } from './fileKind'
import {
  ACCEPTED_FILE_TYPES,
  uploadStore,
  type UploadItem,
} from './useUploadStore'

interface UploadPicker {
  // 새 파일 고르기 → 확인 시트.
  open: () => void
  // 이어올리기 대기 파일 다시 고르기. 같은 파일은 확인 없이 원래 태그로.
  resume: () => void
}

const PickerContext = createContext<UploadPicker | null>(null)

// 시트·대화상자 청크는 첫 선택 때 로딩.
const UploadConfirm = lazy(() =>
  import('./UploadConfirm').then((m) => ({ default: m.UploadConfirm })),
)

export interface PendingFile {
  key: number
  file: File
}

function sameFile(item: UploadItem, file: File): boolean {
  return (
    item.name === file.name &&
    item.resume?.size === file.size &&
    item.resume.lastModified === file.lastModified
  )
}

function isFileDrag(e: DragEvent): boolean {
  return e.dataTransfer?.types.includes('Files') ?? false
}

// 셸 전체 공용 숨은 파일 입력 하나. (+)·사이드바·빈 화면·업로드 목록 버튼이 같은 선택창 사용.
// 창 전체 끌어다 놓기도 같은 확인 시트로.
export function UploadPickerProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { user } = useMe()
  const canUpload = hasRole(user, 'guardian')
  const inputRef = useRef<HTMLInputElement>(null)
  const mode = useRef<'new' | 'resume'>('new')
  const nextKey = useRef(0)
  const [pending, setPending] = useState<PendingFile[] | null>(null)
  const [dragging, setDragging] = useState(false)
  const [picker] = useState<UploadPicker>(() => ({
    open: () => {
      mode.current = 'new'
      inputRef.current?.click()
    },
    resume: () => {
      mode.current = 'resume'
      inputRef.current?.click()
    },
  }))

  // 확인 시트에 추가(열려 있으면 뒤에 붙임). 사진·영상 외 파일은 제외.
  function confirm(files: File[]) {
    const media = files.filter((f) => mediaKind(f) !== null)
    if (media.length < files.length) {
      toast.error(t('upload.status.unsupported'))
    }
    if (media.length === 0) return
    const added = media.map((file) => ({ key: nextKey.current++, file }))
    setPending((prev) => [...(prev ?? []), ...added])
  }

  // Uppy 는 첫 업로드 때 지연 로딩.
  async function upload(groups: { files: File[]; babyIds: string[] }[]) {
    try {
      const { getUploader } = await import('./uploader')
      for (const g of groups) getUploader(qc).add(g.files, g.babyIds)
    } catch {
      toast.error(t('errors.unknown'))
    }
  }

  // 새로고침 전 파일과 같으면 원래 태그로 바로 이어 올림(지운 아기 제외). 나머지는 확인 시트.
  async function resume(files: File[]) {
    const waiting = uploadStore
      .getSnapshot()
      .filter((i) => i.status === 'resumable')
    const groups = new Map<string, { files: File[]; babyIds: string[] }>()
    const rest: File[] = []
    for (const file of files) {
      const item = waiting.find((i) => sameFile(i, file))
      if (!item?.resume) {
        rest.push(file)
        continue
      }
      const key = JSON.stringify(item.resume.babyIds)
      const g = groups.get(key) ?? { files: [], babyIds: item.resume.babyIds }
      g.files.push(file)
      groups.set(key, g)
    }
    if (rest.length > 0) confirm(rest)
    if (groups.size === 0) return
    const babies = await qc
      .query({ ...babiesQuery, staleTime: 'static' })
      .catch(() => null)
    await upload(
      [...groups.values()].map((g) => ({
        files: g.files,
        babyIds: babies
          ? g.babyIds.filter((id) => babies.some((b) => b.id === id))
          : g.babyIds,
      })),
    )
  }

  // 파일 끌기만 처리. 권한 없어도 놓기 기본 동작(파일 열기로 페이지 이탈)은 차단.
  const onDrag = useEffectEvent((e: DragEvent, depth: number) => {
    if (e.type === 'drop') {
      setDragging(false)
      if (canUpload) confirm([...(e.dataTransfer?.files ?? [])])
      return
    }
    setDragging(canUpload && depth > 0)
  })

  useEffect(() => {
    // 자식 요소 사이 이동마다 enter/leave 반복. 깊이로 창 밖 이탈 판단.
    let depth = 0
    // 화면 안 사진 끌기(Chrome 은 Files 형식 포함). 놓기 기본 동작 차단만.
    let inPage = false
    const start = () => {
      inPage = true
    }
    const end = () => {
      inPage = false
    }
    const enter = (e: DragEvent) => {
      if (inPage || !isFileDrag(e)) return
      depth += 1
      onDrag(e, depth)
    }
    const leave = (e: DragEvent) => {
      if (inPage || !isFileDrag(e)) return
      depth = Math.max(0, depth - 1)
      onDrag(e, depth)
    }
    const over = (e: DragEvent) => {
      if (isFileDrag(e)) e.preventDefault()
    }
    const drop = (e: DragEvent) => {
      if (!isFileDrag(e)) return
      e.preventDefault()
      depth = 0
      if (inPage) {
        inPage = false
        return
      }
      onDrag(e, depth)
    }
    window.addEventListener('dragstart', start)
    window.addEventListener('dragend', end)
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragstart', start)
      window.removeEventListener('dragend', end)
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [])

  return (
    <PickerContext value={picker}>
      {children}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED_FILE_TYPES.join(',')}
        className="hidden"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const files = [...(e.currentTarget.files ?? [])]
          // 같은 파일 다시 선택(이어 올리기·다시 올리기) 허용.
          e.currentTarget.value = ''
          if (files.length === 0) return
          if (mode.current === 'resume') void resume(files)
          else confirm(files)
        }}
      />
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center border-4 border-dashed border-primary bg-background/80">
          <p className="text-lg font-semibold">{t('upload.dropHere')}</p>
        </div>
      )}
      {pending && (
        <Suspense>
          <UploadConfirm
            files={pending}
            onRemove={(key) => {
              const next = pending.filter((f) => f.key !== key)
              setPending(next.length > 0 ? next : null)
            }}
            onCancel={() => {
              setPending(null)
            }}
            onSubmit={(files, babyIds) => {
              setPending(null)
              void upload([{ files, babyIds }])
            }}
          />
        </Suspense>
      )}
    </PickerContext>
  )
}

export function useUploadPicker(): UploadPicker {
  const picker = use(PickerContext)
  if (!picker) throw new Error('UploadPickerProvider 밖에서 사용')
  return picker
}
