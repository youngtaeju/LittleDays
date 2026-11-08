import { useSyncExternalStore } from 'react'
import type { ApiError } from '@/api/errors'

// 파일 선택 accept·Uppy 제한 공용. 확장자는 MIME 을 비워 보내는 브라우저 대응.
export const ACCEPTED_FILE_TYPES = ['image/*', 'video/*', '.heic', '.heif']

export type UploadStatus =
  | 'queued'
  | 'uploading'
  | 'finalizing'
  | 'done'
  | 'duplicate'
  | 'unsupported'
  | 'lost'
  | 'error'

export interface UploadItem {
  // Uppy 파일 ID. 같은 파일은 같은 ID.
  id: string
  name: string
  status: UploadStatus
  // 0~1. uploading 에서만 의미.
  progress: number
  // done·duplicate 의 자산.
  assetId?: string
  inTrash?: boolean
  restored?: boolean
  error?: ApiError
}

export function isActive(status: UploadStatus): boolean {
  return (
    status === 'queued' || status === 'uploading' || status === 'finalizing'
  )
}

// 모듈 단위 단일 큐. 페이지 이동 후에도 유지. Uppy 미로딩 상태에서도 구독 가능.
let items: readonly UploadItem[] = []
const listeners = new Set<() => void>()

function activeCount(): number {
  return items.filter((i) => isActive(i.status)).length
}

// 진행 중 업로드가 있을 때만 이탈 경고 등록. 없을 때 해제(bfcache 유지).
function warnUnload(e: BeforeUnloadEvent): void {
  e.preventDefault()
  // 구형 브라우저(preventDefault 미지원) 대응.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  e.returnValue = ''
}
let warning = false

function set(next: readonly UploadItem[]): void {
  items = next
  const active = activeCount() > 0
  if (active !== warning) {
    warning = active
    if (active) window.addEventListener('beforeunload', warnUnload)
    else window.removeEventListener('beforeunload', warnUnload)
  }
  for (const l of listeners) l()
}

// 업로더 내부 상태 정리. 업로더 생성 때 등록. Uppy 를 import 하지 않기 위한 우회.
let cleanup: (() => void) | undefined

export function registerUploadCleanup(fn: () => void): void {
  cleanup = fn
}

// 로그아웃 공용. 다음 사용자에게 이전 사용자 파일·재전송이 넘어가지 않도록 큐 전체 폐기.
export function clearUploads(): void {
  cleanup?.()
  set([])
}

export const uploadStore = {
  getSnapshot: (): readonly UploadItem[] => items,
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  // 같은 ID 는 자리 유지 교체(같은 파일 다시 선택·다시 올리기).
  put: (item: UploadItem): void => {
    set(
      items.some((x) => x.id === item.id)
        ? items.map((x) => (x.id === item.id ? item : x))
        : [...items, item],
    )
  },
  patch: (id: string, patch: Partial<Omit<UploadItem, 'id'>>): void => {
    set(items.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  },
  activeCount,
  // 테스트 격리용.
  reset: (): void => {
    set([])
  },
}

export function useUploadStore(): readonly UploadItem[] {
  return useSyncExternalStore(uploadStore.subscribe, uploadStore.getSnapshot)
}

// 셸 뱃지용. 진행 중·대기·마무리 개수.
export function useActiveUploadCount(): number {
  return useSyncExternalStore(uploadStore.subscribe, activeCount)
}
