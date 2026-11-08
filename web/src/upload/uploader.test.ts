import { QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/errors'
import { useLogout } from '@/auth/session'
import { json, mockFetch } from '@/test/fetch'
import { assetFixture } from '@/test/fixtures'
import { createTestQueryClient } from '@/test/query'
import { createUploader, getUploader, uppyOptions } from './uploader'
import { uploadStore } from './useUploadStore'

afterEach(() => {
  uploadStore.reset()
  vi.restoreAllMocks()
})

function photo(name: string, type = 'image/jpeg'): File {
  return new File(['x'], name, { type, lastModified: 1_700_000_000_000 })
}

describe('uploader', () => {
  it('uppy_options', () => {
    const o = uppyOptions()
    expect(o.chunkSize).toBe(8388608)
    expect(o.headers).toEqual({ 'X-Requested-With': 'LittleDays' })
    expect(
      (o.retryDelays ?? []).reduce((a, b) => a + b, 0),
    ).toBeGreaterThanOrEqual(69000)
    expect(o.storeFingerprintForResuming).toBe(true)
    expect(o.removeFingerprintOnSuccess).toBe(true)
    expect(o.withCredentials).toBe(true)
    // tus-js-client 가 Location 을 endpoint 기준으로 해석. 절대 URL 필요.
    expect(o.endpoint).toBe(`${location.origin}/api/uploads`)
    expect(o.allowedMetaFields).toEqual(['filename', 'filetype'])
  })

  it('tus_metadata_has_filename', () => {
    const uppy = createUploader()
    uppy.setOptions({ autoProceed: false })
    const id = uppy.addFile({
      name: '아기.heic',
      type: '',
      data: photo('아기.heic', ''),
      meta: { babyIds: [] },
    })
    expect(uppy.getFile(id).meta).toMatchObject({
      filename: '아기.heic',
      filetype: 'image/heic',
    })
    expect(() =>
      uppy.addFile({
        name: 'note.txt',
        type: 'text/plain',
        data: photo('note.txt', 'text/plain'),
        meta: { babyIds: [] },
      }),
    ).toThrow()
    uppy.destroy()
  })

  it('invalidates_assets_once_when_queue_drains', async () => {
    const qc = createTestQueryClient()
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const { uppy } = getUploader(qc)
    uppy.setOptions({ autoProceed: false })
    const add = (n: string) =>
      uppy.addFile({
        name: n,
        type: 'image/jpeg',
        data: photo(n),
        meta: { babyIds: ['b1'] },
      })
    const a = add('a.jpg')
    const b = add('b.jpg')
    mockFetch({
      'POST /api/uploads/u1/finalize': () => json(201, assetFixture('x1')),
      'POST /api/uploads/u2/finalize': () => json(201, assetFixture('x2')),
    })
    const success = (id: string, upload: string) => {
      uppy.emit('upload-success', uppy.getFile(id), {
        uploadURL: `${location.origin}/api/uploads/${upload}`,
        status: 200,
        body: { xhr: new XMLHttpRequest() },
      })
    }
    const status = (id: string) =>
      uploadStore.getSnapshot().find((i) => i.id === id)?.status

    success(a, 'u1')
    await waitFor(() => {
      expect(status(a)).toBe('done')
    })
    expect(status(b)).toBe('queued')
    expect(invalidate).not.toHaveBeenCalled()
    // 완료 파일은 Uppy 에서 제거. 같은 파일 다시 선택 허용.
    expect(uppy.getFiles().map((f) => f.id)).toEqual([b])

    success(b, 'u2')
    await waitFor(() => {
      expect(status(b)).toBe('done')
    })
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['assets'] })
  })

  it('logout_clears_queue_and_uploader', async () => {
    const qc = createTestQueryClient()
    const { uppy } = getUploader(qc)
    uppy.setOptions({ autoProceed: false })
    const cancelAll = vi.spyOn(uppy, 'cancelAll')
    // 실패 1개 + 대기 1개.
    function fill() {
      const failed = uppy.addFile({
        name: 'a.jpg',
        type: 'image/jpeg',
        data: photo('a.jpg'),
        meta: { babyIds: ['b1'] },
      })
      uppy.addFile({
        name: 'b.jpg',
        type: 'image/jpeg',
        data: photo('b.jpg'),
        meta: { babyIds: ['b1'] },
      })
      uploadStore.patch(failed, {
        status: 'error',
        error: new ApiError(401, 'auth.required', {}),
      })
      expect(uploadStore.getSnapshot()).toHaveLength(2)
    }
    function expectCleared(calls: number) {
      expect(uploadStore.getSnapshot()).toEqual([])
      expect(cancelAll).toHaveBeenCalledTimes(calls)
      expect(uppy.getFiles()).toEqual([])
    }

    // 강제 로그아웃(401 auth.required).
    fill()
    await expect(
      qc.query({
        queryKey: ['x'],
        queryFn: () => Promise.reject(new ApiError(401, 'auth.required', {})),
      }),
    ).rejects.toThrow()
    expectCleared(1)

    // 직접 로그아웃.
    fill()
    mockFetch({ 'POST /api/auth/logout': () => json(204, null) })
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children)
    const { result } = renderHook(() => useLogout(), { wrapper })
    await act(() => result.current())
    expectCleared(2)
  })
})
