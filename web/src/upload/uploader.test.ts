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

  // MIME 없는 파일(끌어다 놓기 등)은 확장자로 형식 보정. Uppy 기본 표에 없는 3gp·jpeg 포함.
  it('empty_mime_uses_extension', () => {
    const qc = createTestQueryClient()
    const up = getUploader(qc)
    up.uppy.setOptions({ autoProceed: false })
    up.add([photo('clip.3gp', ''), photo('a.jpeg', '')], [])
    expect(uploadStore.getSnapshot().map((i) => i.status)).toEqual([
      'queued',
      'queued',
    ])
    expect(up.uppy.getFiles().map((f) => f.meta.filetype)).toEqual([
      'video/3gpp',
      'image/jpeg',
    ])
    up.uppy.cancelAll()
  })

  // 대표 사진 올리기가 해당 항목 추적. 큐에 이미 있는 파일·지원 안 함도 항목 ID.
  it('add_returns_item_ids', () => {
    const up = getUploader(createTestQueryClient())
    up.uppy.setOptions({ autoProceed: false })
    const [a] = up.add([photo('a.jpg')], ['b1'])
    expect(a).toBeDefined()
    expect(up.add([photo('a.jpg')], ['b1'])).toEqual([a])
    const ids = up.add([photo('b.jpg'), photo('note.txt', 'text/plain')], [])
    expect(ids).toHaveLength(2)
    const status = (id: string | undefined) =>
      uploadStore.getSnapshot().find((i) => i.id === id)?.status
    expect(status(a)).toBe('queued')
    expect(ids.map(status)).toEqual(['queued', 'unsupported'])
    up.uppy.cancelAll()
  })

  // 붙일 대상은 finalize 본문과 이어올리기 기록에. tus 메타데이터에는 없음.
  it('add_with_attach_finalizes_attach', async () => {
    const up = getUploader(createTestQueryClient())
    up.uppy.setOptions({ autoProceed: false })
    const attach = { kind: 'story' as const, id: 's1' }
    const [id] = up.add([photo('s.jpg')], ['b1'], attach)
    if (!id) throw new Error('항목 없음')
    expect(uploadStore.getSnapshot()[0]?.resume).toEqual({
      size: 1,
      lastModified: 1_700_000_000_000,
      babyIds: ['b1'],
      attach,
    })
    let body: unknown
    mockFetch({
      'POST /api/uploads/u1/finalize': async (req) => {
        body = await req.json()
        return json(201, assetFixture('x1'))
      },
    })
    up.uppy.emit('upload-success', up.uppy.getFile(id), {
      uploadURL: `${location.origin}/api/uploads/u1`,
      status: 200,
      body: { xhr: new XMLHttpRequest() },
    })
    await waitFor(() => {
      expect(body).toEqual({
        baby_ids: ['b1'],
        file_modified_at: new Date(1_700_000_000_000).toISOString(),
        attach,
      })
    })
  })

  // 큐에 이미 있는 파일을 붙일 대상과 함께 다시 추가하면 대상만 갱신.
  it('readd_existing_sets_attach', () => {
    const up = getUploader(createTestQueryClient())
    up.uppy.setOptions({ autoProceed: false })
    const [id] = up.add([photo('a.jpg')], ['b1'])
    if (!id) throw new Error('항목 없음')
    const attach = { kind: 'story' as const, id: 's1' }
    expect(up.add([photo('a.jpg')], ['b1'], attach)).toEqual([id])
    expect(up.uppy.getFile(id).meta.attach).toEqual(attach)
    expect(uploadStore.getSnapshot()[0]?.resume?.attach).toEqual(attach)
    up.uppy.cancelAll()
  })

  it('invalidates_lists_once_when_queue_drains', async () => {
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
    expect(invalidate).toHaveBeenCalledTimes(2)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['assets'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['days'] })
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
