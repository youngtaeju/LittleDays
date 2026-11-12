import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/errors'
import sessionSource from '@/auth/session.ts?raw'
import storeSource from './useUploadStore.ts?raw'
import {
  clearUploads,
  registerUploadCleanup,
  restorePendingUploads,
  uploadStore,
} from './useUploadStore'

afterEach(() => {
  uploadStore.reset()
})

function unload(): Event {
  const e = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(e)
  return e
}

describe('useUploadStore', () => {
  it('warns_before_unload_while_uploading', () => {
    expect(unload().defaultPrevented).toBe(false)

    uploadStore.put({
      id: 'f1',
      name: 'a.jpg',
      status: 'uploading',
      progress: 0,
    })
    expect(unload().defaultPrevented).toBe(true)

    uploadStore.patch('f1', { status: 'finalizing' })
    expect(unload().defaultPrevented).toBe(true)

    uploadStore.patch('f1', { status: 'done' })
    expect(unload().defaultPrevented).toBe(false)
  })

  it('clear_uploads_runs_registered_cleanup', () => {
    const cleanup = vi.fn()
    registerUploadCleanup(cleanup)
    uploadStore.put({ id: 'f1', name: 'a.jpg', status: 'queued', progress: 0 })
    clearUploads()
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(uploadStore.getSnapshot()).toEqual([])
    expect(unload().defaultPrevented).toBe(false)
  })

  it('pending_uploads_survive_reload', () => {
    const resume = { size: 10, lastModified: 1, babyIds: ['b1'] }
    uploadStore.put({
      id: 'f1',
      name: 'a.jpg',
      status: 'uploading',
      progress: 0.5,
      resume,
    })
    uploadStore.put({
      id: 'f2',
      name: 'b.jpg',
      status: 'done',
      progress: 1,
      resume,
    })
    const saved = localStorage.getItem('ld.upload.pending')
    expect(saved).not.toBeNull()

    // 새로고침: 모듈 상태 소실, 저장값만 남음.
    uploadStore.reset()
    expect(localStorage.getItem('ld.upload.pending')).toBeNull()
    localStorage.setItem('ld.upload.pending', saved ?? '')
    restorePendingUploads()
    expect(uploadStore.getSnapshot()).toEqual([
      { id: 'f1', name: 'a.jpg', status: 'resumable', progress: 0, resume },
    ])
    // 이어올리기 대기는 이탈 경고 대상 아님.
    expect(unload().defaultPrevented).toBe(false)

    // 다시 고른 파일이 끝나면 저장값 제거.
    uploadStore.put({
      id: 'f1',
      name: 'a.jpg',
      status: 'done',
      progress: 1,
      resume,
    })
    expect(localStorage.getItem('ld.upload.pending')).toBeNull()
  })

  // 이야기, 마일스톤에 붙일 새 사진. 새로고침 뒤 이어올리기에도 같은 대상.
  it('pending_keeps_attach', () => {
    const resume = {
      size: 10,
      lastModified: 1,
      babyIds: ['b1'],
      attach: { kind: 'story' as const, id: 's1' },
    }
    uploadStore.put({
      id: 'f1',
      name: 'a.jpg',
      status: 'uploading',
      progress: 0.5,
      resume,
    })
    const saved = localStorage.getItem('ld.upload.pending')
    expect(JSON.parse(saved ?? '[]')).toEqual([
      { id: 'f1', name: 'a.jpg', ...resume },
    ])

    uploadStore.reset()
    localStorage.setItem('ld.upload.pending', saved ?? '')
    restorePendingUploads()
    expect(uploadStore.getSnapshot()).toEqual([
      { id: 'f1', name: 'a.jpg', status: 'resumable', progress: 0, resume },
    ])

    // 모양이 틀린 attach 는 기록째 버림.
    uploadStore.reset()
    localStorage.setItem(
      'ld.upload.pending',
      JSON.stringify([
        {
          id: 'f2',
          name: 'b.jpg',
          size: 1,
          lastModified: 1,
          babyIds: [],
          attach: { kind: 'album', id: 's1' },
        },
      ]),
    )
    restorePendingUploads()
    expect(uploadStore.getSnapshot()).toEqual([])
  })

  it('permanent_errors_not_persisted', () => {
    const resume = { size: 1, lastModified: 1, babyIds: [] }
    const pending = () =>
      JSON.parse(localStorage.getItem('ld.upload.pending') ?? '[]') as {
        id: string
      }[]
    uploadStore.put({
      id: 'net',
      name: 'a',
      status: 'queued',
      progress: 0,
      resume,
    })
    uploadStore.put({
      id: 'big',
      name: 'b',
      status: 'queued',
      progress: 0,
      resume,
    })
    uploadStore.put({
      id: 'srv',
      name: 'c',
      status: 'queued',
      progress: 0,
      resume,
    })
    uploadStore.patch('net', {
      status: 'error',
      error: new ApiError(0, 'network.offline', {}),
    })
    uploadStore.patch('big', {
      status: 'error',
      error: new ApiError(413, 'upload.tooLarge', {}),
    })
    uploadStore.patch('srv', {
      status: 'error',
      error: new ApiError(503, 'unknown', {}),
    })
    // 다시 골라도 같은 결과일 4xx 는 새로고침 후 이어올리기 대상 아님.
    expect(pending().map((p) => p.id)).toEqual(['net', 'srv'])
  })

  it('progress_patch_skips_persist', () => {
    uploadStore.put({
      id: 'f1',
      name: 'a.jpg',
      status: 'uploading',
      progress: 0,
      resume: { size: 1, lastModified: 1, babyIds: [] },
    })
    const write = vi.spyOn(Storage.prototype, 'setItem')
    const read = vi.spyOn(JSON, 'stringify')
    uploadStore.patch('f1', { status: 'uploading', progress: 0.3 })
    uploadStore.patch('f1', { progress: 0.6 })
    expect(read).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('restore_ignores_bad_value', () => {
    localStorage.setItem('ld.upload.pending', '[{"id":1}]')
    restorePendingUploads()
    expect(uploadStore.getSnapshot()).toEqual([])
    localStorage.setItem('ld.upload.pending', '{')
    restorePendingUploads()
    expect(uploadStore.getSnapshot()).toEqual([])
  })

  it('logout_forgets_pending', () => {
    uploadStore.put({
      id: 'f1',
      name: 'a.jpg',
      status: 'error',
      progress: 0,
      resume: { size: 1, lastModified: 1, babyIds: [] },
    })
    expect(localStorage.getItem('ld.upload.pending')).not.toBeNull()
    clearUploads()
    expect(localStorage.getItem('ld.upload.pending')).toBeNull()
  })

  // 셸·세션은 Uppy 지연 청크를 정적으로 끌어오지 않음. 타입 import 만 허용.
  it('session_and_store_do_not_import_uploader', () => {
    const valueImport = /^import\s+(?!type\b)[^;]*from\s+'[^']*\/uploader'/m
    expect(sessionSource).toMatch(/from '@\/upload\/useUploadStore'/)
    expect(sessionSource).not.toMatch(valueImport)
    expect(storeSource).not.toMatch(valueImport)
    expect(storeSource).not.toMatch(/@uppy\//)
  })
})
