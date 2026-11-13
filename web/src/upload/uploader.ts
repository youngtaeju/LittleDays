import type { QueryClient } from '@tanstack/react-query'
import Uppy, { type UppyFile } from '@uppy/core'
import Tus, { type TusBody, type TusOptions } from '@uppy/tus'
import { albumsKeyRoot } from '@/albums/useAlbums'
import { errorBody } from '@/api/client'
import { ApiError } from '@/api/errors'
import type { AttachTarget } from '@/api/types'
import { milestoneKey, milestonesKeyRoot } from '@/milestones/useMilestones'
import { storyKey } from '@/stories/useStory'
import { fileMime } from './fileKind'
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

// babyIds, attach 는 finalize 용. tus metadata 로는 filename, filetype 만 전송.
type UploadMeta = {
  babyIds: string[]
  attach?: AttachTarget
  filename?: string
  filetype?: string
}
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
  // 반환: 파일별 업로드 목록 항목 ID(큐에 이미 있는 파일·지원 안 함 포함).
  // attach: 마무리 때 붙일 이야기, 마일스톤, 앨범.
  add: (files: File[], babyIds: string[], attach?: AttachTarget) => string[]
  retry: (id: string) => void
}

let uploader: Uploader | undefined
let queryClient: QueryClient | undefined

function createQueue(): Uploader {
  const uppy = createUploader()
  // 전송 완료 파일. finalize 재시도·다시 올리기용.
  const sent = new Map<
    string,
    {
      data: File
      babyIds: string[]
      attach: AttachTarget | undefined
      uploadUrl: string
    }
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
      s.attach,
    )
    // 같은 파일 다시 선택 허용. await 이후라 tus 이벤트 정리 완료(동기 제거 시 업로드 DELETE).
    if (uppy.checkIfFileAlreadyExists(id)) uppy.removeFile(id)
    // 새 자산, 중복 모두 서버가 대상에 연결. 열린 이야기, 마일스톤, 앨범에 바로 반영.
    // 중복은 settle 의 ['assets'] 무효화 대상 아님. 앨범도 여기서 직접.
    if (
      s.attach &&
      (outcome.kind === 'created' || outcome.kind === 'duplicate')
    ) {
      const { kind, id: target } = s.attach
      if (kind === 'album') {
        // 앨범 목록 개수, 표지와 앨범 화면 전부. 중복이면 기존 사진 상세의 album_ids 도.
        void queryClient?.invalidateQueries({ queryKey: albumsKeyRoot })
        void queryClient?.invalidateQueries({ queryKey: ['asset'] })
      } else {
        void queryClient?.invalidateQueries({
          queryKey: kind === 'story' ? storyKey(target) : milestoneKey(target),
        })
      }
      // 아기 화면 타임라인 썸네일. 대상 아기를 모르니 아기별 목록 전부.
      if (kind === 'milestone') {
        void queryClient?.invalidateQueries({ queryKey: milestonesKeyRoot })
      }
    }
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
      resume:
        file.data instanceof File
          ? {
              size: file.data.size,
              lastModified: file.data.lastModified,
              babyIds: file.meta.babyIds,
              ...(file.meta.attach && { attach: file.meta.attach }),
            }
          : undefined,
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
      attach: file.meta.attach,
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

  // 진행 중 파일에 붙일 대상 지정. 마무리 요청, 이어올리기 기록 모두 반영.
  function setAttach(id: string, attach: AttachTarget): void {
    uppy.setFileMeta(id, { ...uppy.getFile(id).meta, attach })
    const s = sent.get(id)
    if (s) s.attach = attach
    const resume = uploadStore.getSnapshot().find((i) => i.id === id)?.resume
    if (resume) uploadStore.patch(id, { resume: { ...resume, attach } })
  }

  function add(
    files: File[],
    babyIds: string[],
    attach?: AttachTarget,
  ): string[] {
    uploadStore.startRun()
    // addFiles 안에서 동기로 발생하는 이벤트로 ID 수집. 이벤트 순서와 무관하게 파일 순서로.
    const ids = new Map<unknown, string>()
    // 큐에 이미 있는 파일(같은 ID). 붙일 대상만 갱신 대상.
    const existing: string[] = []
    const added = (file: { id: string; data: unknown }) => {
      ids.set(file.data, file.id)
    }
    const rejected = (file: { id: string; data: unknown } | undefined) => {
      if (!file) return
      ids.set(file.data, file.id)
      if (uppy.checkIfFileAlreadyExists(file.id)) existing.push(file.id)
    }
    uppy.on('file-added', added).on('restriction-failed', rejected)
    try {
      uppy.addFiles(
        files.map((data) => ({
          name: data.name,
          // MIME 없는 파일은 확장자로 보정(Uppy 제한·tus filetype).
          type: fileMime(data),
          data,
          meta: attach ? { babyIds, attach } : { babyIds },
        })),
      )
    } finally {
      uppy.off('file-added', added).off('restriction-failed', rejected)
    }
    if (attach) for (const id of existing) setAttach(id, attach)
    return files.flatMap((f) => ids.get(f) ?? [])
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
        add([s.data], s.babyIds, s.attach)
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
