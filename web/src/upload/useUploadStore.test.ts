import { afterEach, describe, expect, it, vi } from 'vitest'
import sessionSource from '@/auth/session.ts?raw'
import storeSource from './useUploadStore.ts?raw'
import {
  clearUploads,
  registerUploadCleanup,
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

  // 셸·세션은 Uppy 지연 청크를 정적으로 끌어오지 않음. 타입 import 만 허용.
  it('session_and_store_do_not_import_uploader', () => {
    const valueImport = /^import\s+(?!type\b)[^;]*from\s+'[^']*\/uploader'/m
    expect(sessionSource).toMatch(/from '@\/upload\/useUploadStore'/)
    expect(sessionSource).not.toMatch(valueImport)
    expect(storeSource).not.toMatch(valueImport)
    expect(storeSource).not.toMatch(/@uppy\//)
  })
})
