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
  // 새로고침 전 끝나지 않은 파일. 같은 파일을 다시 골라야 이어 올림.
  | 'resumable'

// 새로고침 후 같은 파일 대조·원래 아기 태그 복원용.
export interface ResumeInfo {
  size: number
  lastModified: number
  babyIds: string[]
}

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
  resume?: ResumeInfo
}

export function isActive(status: UploadStatus): boolean {
  return (
    status === 'queued' || status === 'uploading' || status === 'finalizing'
  )
}

export function isFailed(status: UploadStatus): boolean {
  return status === 'error' || status === 'lost' || status === 'unsupported'
}

// 누를 때까지 알약 유지 대상. 실패, 휴지통에 있는 중복.
function needsAttention(i: UploadItem): boolean {
  return (
    isFailed(i.status) ||
    (i.status === 'duplicate' && i.inTrash === true && !i.restored)
  )
}

// 다시 골라도 같은 결과일 오류(크기 초과 등 4xx)는 이어올리기 대상 아님.
function retryable(e: ApiError | undefined): boolean {
  if (!e) return true
  const s = e.status
  return s === 0 || s >= 500 || s === 408 || s === 409 || s === 429
}

// 알약 표시. 진행 > 완료(3초) > 실패 > 휴지통 중복(누를 때까지) > 이어올리기 대기.
export type PillState =
  | { kind: 'progress'; count: number; percent: number }
  | { kind: 'done' | 'failed' | 'trash' | 'resumable'; count: number }
  | null

// 모듈 단위 단일 큐. 페이지 이동 후에도 유지. Uppy 미로딩 상태에서도 구독 가능.
let items: readonly UploadItem[] = []
// 현재 묶음(알약 집계 대상). 진행 중 항목이 없다가 생기면 새 묶음.
let run: ReadonlySet<string> = new Set()
// 완료 알약 시간 만료·누름.
let runDismissed = false
// 알약을 눌러 확인한 실패·휴지통 중복. 다시 진행하면 제외.
let seen: ReadonlySet<string> = new Set()
let pill: PillState = null
let queueOpen = false
const listeners = new Set<() => void>()

function activeCount(): number {
  return items.filter((i) => isActive(i.status)).length
}

function itemProgress(i: UploadItem): number {
  if (i.status === 'queued') return 0
  if (i.status === 'uploading') return i.progress
  return 1
}

function computePill(): PillState {
  const inRun = items.filter((i) => run.has(i.id) && i.status !== 'resumable')
  if (inRun.some((i) => isActive(i.status))) {
    const sum = inRun.reduce((s, i) => s + itemProgress(i), 0)
    return {
      kind: 'progress',
      count: inRun.length,
      percent: Math.floor((sum / inRun.length) * 100),
    }
  }
  // 확인 안 한 항목은 이전 묶음 것도 유지.
  const attention = items.filter((i) => needsAttention(i) && !seen.has(i.id))
  if (
    !runDismissed &&
    inRun.length > 0 &&
    !inRun.some((i) => attention.includes(i))
  ) {
    return { kind: 'done', count: inRun.length }
  }
  const failed = attention.filter((i) => isFailed(i.status)).length
  if (failed > 0) return { kind: 'failed', count: failed }
  if (attention.length > 0) return { kind: 'trash', count: attention.length }
  const resumable = items.filter((i) => i.status === 'resumable').length
  return resumable > 0 ? { kind: 'resumable', count: resumable } : null
}

// 진행 중·실패 파일. 새로고침 뒤 이어올리기 대기로 복원. 기기별 저장.
const PENDING_KEY = 'ld.upload.pending'
let persisted: string | null = null

interface PendingRecord extends ResumeInfo {
  id: string
  name: string
}

function persist(): void {
  const pending: PendingRecord[] = items.flatMap((i) =>
    i.resume &&
    (isActive(i.status) ||
      i.status === 'resumable' ||
      i.status === 'lost' ||
      (i.status === 'error' && retryable(i.error)))
      ? [{ id: i.id, name: i.name, ...i.resume }]
      : [],
  )
  const value = pending.length > 0 ? JSON.stringify(pending) : null
  if (value === persisted) return
  persisted = value
  try {
    if (value) localStorage.setItem(PENDING_KEY, value)
    else localStorage.removeItem(PENDING_KEY)
  } catch {
    // 저장 불가면 새로고침 후 이어올리기 안내 없음(tus 이어받기 자체는 유지).
  }
}

// 진행 중 업로드가 있을 때만 이탈 경고 등록. 없을 때 해제(bfcache 유지).
function warnUnload(e: BeforeUnloadEvent): void {
  e.preventDefault()
  // 구형 브라우저(preventDefault 미지원) 대응.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  e.returnValue = ''
}
let warning = false

function notify(): void {
  pill = computePill()
  for (const l of listeners) l()
}

// join = 묶음에 넣을 항목(지원 안 함 등 진행 상태를 거치지 않는 항목 포함).
// save = 저장 대상 변경 가능성. 진행률만 바뀌면 생략.
function set(next: readonly UploadItem[], join?: string, save = true): void {
  items = next
  const active = activeCount() > 0
  if (active && !warning) {
    run = new Set()
    runDismissed = false
  }
  const ids = items.filter((i) => isActive(i.status)).map((i) => i.id)
  if (join) ids.push(join)
  if (ids.some((id) => !run.has(id))) run = new Set([...run, ...ids])
  if (ids.some((id) => seen.has(id))) {
    seen = new Set([...seen].filter((id) => !ids.includes(id)))
  }
  if (active !== warning) {
    warning = active
    if (active) window.addEventListener('beforeunload', warnUnload)
    else window.removeEventListener('beforeunload', warnUnload)
  }
  if (save) persist()
  notify()
}

// 업로더 내부 상태 정리. 업로더 생성 때 등록. Uppy 를 import 하지 않기 위한 우회.
let cleanup: (() => void) | undefined

export function registerUploadCleanup(fn: () => void): void {
  cleanup = fn
}

function resetAll(): void {
  run = new Set()
  runDismissed = false
  seen = new Set()
  queueOpen = false
  // 이전 저장값과 무관하게 삭제(복원 실패한 값 포함).
  persisted = ''
  set([])
}

// 로그아웃 공용. 다음 사용자에게 이전 사용자 파일·재전송이 넘어가지 않도록 큐 전체 폐기.
export function clearUploads(): void {
  cleanup?.()
  resetAll()
}

function parsePending(raw: string | null): PendingRecord[] {
  let value: unknown
  try {
    value = JSON.parse(raw ?? '[]')
  } catch {
    return []
  }
  if (!Array.isArray(value)) return []
  return (value as unknown[]).filter((r): r is PendingRecord => {
    if (typeof r !== 'object' || r === null) return false
    const p = r as Record<string, unknown>
    return (
      typeof p.id === 'string' &&
      typeof p.name === 'string' &&
      typeof p.size === 'number' &&
      typeof p.lastModified === 'number' &&
      Array.isArray(p.babyIds) &&
      p.babyIds.every((b) => typeof b === 'string')
    )
  })
}

// 앱 시작 시 1회. 테스트는 새로고침 대신 직접 호출.
export function restorePendingUploads(): void {
  let raw: string | null
  try {
    raw = localStorage.getItem(PENDING_KEY)
  } catch {
    return
  }
  const restored = parsePending(raw)
    .filter((r) => !items.some((i) => i.id === r.id))
    .map(({ id, name, size, lastModified, babyIds }): UploadItem => ({
      id,
      name,
      status: 'resumable',
      progress: 0,
      resume: { size, lastModified, babyIds },
    }))
  set([...items, ...restored])
}

restorePendingUploads()

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
      item.id,
    )
  },
  patch: (id: string, patch: Partial<Omit<UploadItem, 'id'>>): void => {
    const cur = items.find((x) => x.id === id)
    const progressOnly =
      cur !== undefined &&
      Object.entries(patch).every(
        ([k, v]) => k === 'progress' || cur[k as keyof UploadItem] === v,
      )
    set(
      items.map((x) => (x.id === id ? { ...x, ...patch } : x)),
      undefined,
      !progressOnly,
    )
  },
  // 새 파일 추가 직전. 진행 중이 없으면 새 묶음(이전 결과 알약 교체).
  startRun: (): void => {
    if (activeCount() > 0) return
    run = new Set()
    runDismissed = false
    notify()
  },
  // 완료 알약 시간 만료.
  dismissRun: (): void => {
    runDismissed = true
    notify()
  },
  // 알약 누름. 완료·실패·휴지통 중복 확인으로 숨김.
  acknowledge: (): void => {
    runDismissed = true
    seen = new Set([...seen, ...items.filter(needsAttention).map((i) => i.id)])
    notify()
  },
  // 이어올리기 포기. 저장값도 제거.
  discardResumable: (): void => {
    const next = items.filter((i) => i.status !== 'resumable')
    if (next.length === 0) queueOpen = false
    set(next)
  },
  openQueue: (): void => {
    queueOpen = true
    notify()
  },
  closeQueue: (): void => {
    queueOpen = false
    notify()
  },
  activeCount,
  // 테스트 격리용.
  reset: resetAll,
}

export function useUploadStore(): readonly UploadItem[] {
  return useSyncExternalStore(uploadStore.subscribe, uploadStore.getSnapshot)
}

export function useUploadPill(): PillState {
  return useSyncExternalStore(uploadStore.subscribe, () => pill)
}

export function useQueueOpen(): boolean {
  return useSyncExternalStore(uploadStore.subscribe, () => queueOpen)
}
