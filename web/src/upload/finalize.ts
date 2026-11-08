import { api, call } from '@/api/client'
import { ApiError } from '@/api/errors'
import type { Asset } from '@/api/types'

export type FinalizeOutcome =
  | { kind: 'created'; asset: Asset }
  | { kind: 'duplicate'; assetId: string; inTrash: boolean }
  | { kind: 'unsupported' }
  | { kind: 'lost' }
  | { kind: 'error'; error: ApiError }

// asset.duplicate params. 생성 타입에 없어 런타임 검사.
function duplicateOf(
  e: ApiError,
): { assetId: string; inTrash: boolean } | null {
  const { asset_id, in_trash } = e.params
  return typeof asset_id === 'string' && typeof in_trash === 'boolean'
    ? { assetId: asset_id, inTrash: in_trash }
    : null
}

// uploadUrl = tus Location. 마지막 경로 조각이 업로드 ID.
export async function finalizeUpload(
  uploadUrl: string,
  babyIds: string[],
  lastModified: number,
): Promise<FinalizeOutcome> {
  const id = new URL(uploadUrl, location.origin).pathname.split('/').at(-1)
  try {
    const asset = await call(
      api.POST('/api/uploads/{id}/finalize', {
        params: { path: { id: id ?? '' } },
        body: {
          baby_ids: babyIds,
          file_modified_at: new Date(lastModified).toISOString(),
        },
      }),
    )
    return { kind: 'created', asset }
  } catch (e) {
    if (!(e instanceof ApiError)) {
      return { kind: 'error', error: new ApiError(0, 'unknown', {}) }
    }
    if (e.status === 409 && e.key === 'asset.duplicate') {
      const dup = duplicateOf(e)
      return dup ? { kind: 'duplicate', ...dup } : { kind: 'error', error: e }
    }
    if (e.status === 400 && e.key === 'upload.unsupportedType') {
      return { kind: 'unsupported' }
    }
    // 이전 finalize 성공 후 응답 유실. 업로드 행은 이미 삭제됨 → 다시 올리면 duplicate.
    if (e.status === 404 && e.key === 'upload.notFound') return { kind: 'lost' }
    return { kind: 'error', error: e }
  }
}
