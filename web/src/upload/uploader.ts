import type { QueryClient } from '@tanstack/react-query'
import Uppy, { type UppyFile } from '@uppy/core'
import Tus, { type TusBody, type TusOptions } from '@uppy/tus'
import { errorBody } from '@/api/client'
import { ApiError } from '@/api/errors'
import { finalizeUpload } from './finalize'
import {
  ACCEPTED_FILE_TYPES,
  registerUploadCleanup,
  uploadStore,
  type UploadItem,
} from './useUploadStore'

export const TUS_CHUNK_SIZE = 8 * 1024 * 1024
// 합 69초 + 첫 시도. 서버 PATCH idle timeout(60초) 동안 이전 PATCH 가 락 보유(409 upload.locked).
export const TUS_RETRY_DELAYS = [0, 1000, 3000, 5000, 10000, 20000, 30000]

// babyIds 는 finalize 용. tus metadata 로는 filename·filetype 만 전송.
type UploadMeta = { babyIds: string[]; filename?: string; filetype?: string }
type UploaderUppy = Uppy<UploadMeta, TusBody>
type UploadResponse = NonNullable<UppyFile<UploadMeta, TusBody>['response']>

export function uppyOptions(): TusOptions<UploadMeta, TusBody> {
  return {
    // tus-js-client 가 상대 Location 을 endpoint 기준 new URL 로 해석. 절대 URL 필요.
    endpoint: `${location.origin}/api/uploads`,
    chunkSize: TUS_CHUNK_SIZE,
    retryDelays: TUS_RETRY_DELAYS,
    headers: { 'X-Requested-With': 'LittleDays' },
    withCredentials: true,
    // 새로고침 후 같은 파일 다시 선택 시 이어 올리기.
    storeFingerprintForResuming: true,
    removeFingerprintOnSuccess: true,
    allowedMetaFields: ['filename', 'filetype'],
    limit: 3,
  }
}

export function createUploader(): UploaderUppy {
  const uppy = new Uppy<UploadMeta, TusBody>({
    autoProceed: true,
    restrictions: { allowedFileTypes: ACCEPTED_FILE_TYPES },
  }).use(Tus<UploadMeta, TusBody>, uppyOptions())
  // 서버 요구 키 filename. type 은 Uppy 가 확장자로 보정한 MIME(HEIC 등).
  uppy.on('file-added', (file) => {
    uppy.setFileMeta(file.id, {
      ...file.meta,
      filename: file.name,
      filetype: file.type,
    })
  })
  return uppy
}

// tus 실패 응답 → ApiError. 응답 없음 = 네트워크 실패.
function tusError(
  response: Omit<UploadResponse, 'uploadURL'> | undefined,
): ApiError {
  const xhr = response?.body?.xhr
  if (!response || !xhr || response.status === 0) {
    return new ApiError(0, 'network.offline', {})
  }
  let body: unknown
  try {
    body = JSON.parse(xhr.responseText)
  } catch {
    body = undefined
  }
  const { key, params } = errorBody(body)
  return new ApiError(response.status, key, params)
}

export interface Uploader {
  uppy: UploaderUppy
  add: (files: File[], babyIds: string[]) => void
  retry: (id: string) => void
}

let uploader: Uploader | undefined
let queryClient: QueryClient | undefined

function createQueue(): Uploader {
  const uppy = createUploader()
  // 전송 완료 파일. finalize 재시도·다시 올리기용.
  const sent = new Map<
    string,
    { data: File; babyIds: string[]; uploadUrl: string }
  >()
  let created = false

  // 큐가 비면 새 자산 반영 1회. 파일마다 무효화하면 타임라인 전체 재조회 반복.
  function settle(id: string, patch: Partial<Omit<UploadItem, 'id'>>): void {
    uploadStore.patch(id, patch)
    if (!created || uploadStore.activeCount() > 0) return
    created = false
    void queryClient?.invalidateQueries({ queryKey: ['assets'] })
    void queryClient?.invalidateQueries({ queryKey: ['days'] })
  }

  async function finalize(id: string): Promise<void> {
    const s = sent.get(id)
    if (!s) return
    uploadStore.patch(id, { status: 'finalizing', error: undefined })
    const outcome = await finalizeUpload(
      s.uploadUrl,
      s.babyIds,
      s.data.lastModified,
    )
    // 같은 파일 다시 선택 허용. await 이후라 tus 이벤트 정리 완료(동기 제거 시 업로드 DELETE).
    if (uppy.checkIfFileAlreadyExists(id)) uppy.removeFile(id)
    switch (outcome.kind) {
      case 'created':
        sent.delete(id)
        created = true
        settle(id, { status: 'done', assetId: outcome.asset.id })
        break
      case 'duplicate':
        sent.delete(id)
        settle(id, {
          status: 'duplicate',
          assetId: outcome.assetId,
          inTrash: outcome.inTrash,
        })
        break
      case 'unsupported':
        sent.delete(id)
        settle(id, { status: 'unsupported' })
        break
      case 'lost':
        settle(id, { status: 'lost' })
        break
      case 'error':
        settle(id, { status: 'error', error: outcome.error })
        break
    }
  }

  uppy.on('file-added', (file) => {
    // 같은 파일 다시 추가 = 새 업로드. 이전 전송 기록 폐기.
    sent.delete(file.id)
    uploadStore.put({
      id: file.id,
      name: file.name,
      status: 'queued',
      progress: 0,
    })
  })
  uppy.on('restriction-failed', (file) => {
    // 이미 큐에 있는 파일 재선택(noDuplicates)은 무시.
    if (!file || uppy.checkIfFileAlreadyExists(file.id)) return
    uploadStore.put({
      id: file.id,
      name: file.name,
      status: 'unsupported',
      progress: 0,
    })
  })
  uppy.on('upload-progress', (file, p) => {
    if (!file || !p.bytesTotal) return
    uploadStore.patch(file.id, {
      status: 'uploading',
      progress: p.bytesUploaded / p.bytesTotal,
    })
  })
  uppy.on('upload-success', (file, response) => {
    if (!file) return
    if (!response.uploadURL || !(file.data instanceof File)) {
      settle(file.id, {
        status: 'error',
        error: new ApiError(0, 'unknown', {}),
      })
      return
    }
    sent.set(file.id, {
      data: file.data,
      babyIds: file.meta.babyIds,
      uploadUrl: response.uploadURL,
    })
    void finalize(file.id)
  })
  uppy.on('upload-error', (file, _error, response) => {
    if (file) settle(file.id, { status: 'error', error: tusError(response) })
  })
  // 실패 파일은 다시 시도·새 파일 추가 때 Uppy 가 다시 전송.
  uppy.on('upload-retry', (file) => {
    uploadStore.patch(file.id, { status: 'queued', error: undefined })
  })
  uppy.on('retry-all', (files) => {
    for (const f of files) {
      uploadStore.patch(f.id, { status: 'queued', error: undefined })
    }
  })

  // 로그아웃 시 전송 중·실패 파일 폐기. 남겨 두면 다음 사용자 세션에서 재전송.
  registerUploadCleanup(() => {
    uppy.cancelAll()
    sent.clear()
    created = false
  })

  function add(files: File[], babyIds: string[]): void {
    uppy.addFiles(
      files.map((data) => ({
        name: data.name,
        type: data.type,
        data,
        meta: { babyIds },
      })),
    )
  }

  return {
    uppy,
    add,
    retry: (id) => {
      const s = sent.get(id)
      const item = uploadStore.getSnapshot().find((i) => i.id === id)
      if (s && item?.status === 'lost') {
        // 응답 유실. 새 업로드로 다시 올림(지문은 성공 시 삭제됨) → 이미 있으면 duplicate.
        sent.delete(id)
        add([s.data], s.babyIds)
      } else if (s) {
        void finalize(id)
      } else if (uppy.checkIfFileAlreadyExists(id)) {
        void uppy.retryUpload(id).catch(() => undefined)
      }
    },
  }
}

// 모듈 단위 단일 인스턴스. 첫 사용 때 생성. 무효화 대상은 최근 호출의 QueryClient.
export function getUploader(qc: QueryClient): Uploader {
  queryClient = qc
  uploader ??= createQueue()
  return uploader
}
