import { describe, expect, it } from 'vitest'
import { json, mockFetch } from '@/test/fetch'
import { apiError, assetFixture } from '@/test/fixtures'
import { finalizeUpload } from './finalize'

const URL_U1 = `${location.origin}/api/uploads/u1`
const KEY = 'POST /api/uploads/u1/finalize'

describe('finalizeUpload', () => {
  it('created', async () => {
    const lastModified = Date.UTC(2024, 4, 10, 3, 0, 0)
    let req: Request | undefined
    let body: unknown
    mockFetch({
      [KEY]: async (r) => {
        req = r
        body = await r.json()
        return json(201, assetFixture('a1'))
      },
    })
    const outcome = await finalizeUpload(URL_U1, ['b1'], lastModified)
    expect(outcome).toEqual({ kind: 'created', asset: assetFixture('a1') })
    expect(new URL(req?.url ?? '').pathname).toBe('/api/uploads/u1/finalize')
    expect(req?.headers.get('X-Requested-With')).toBe('LittleDays')
    expect(body).toEqual({
      baby_ids: ['b1'],
      file_modified_at: '2024-05-10T03:00:00.000Z',
    })
  })

  it('duplicate_in_trash', async () => {
    mockFetch({
      [KEY]: () =>
        json(409, {
          error: 'asset.duplicate',
          params: { asset_id: 'a1', in_trash: true },
        }),
    })
    expect(await finalizeUpload(URL_U1, [], 0)).toEqual({
      kind: 'duplicate',
      assetId: 'a1',
      inTrash: true,
    })
  })

  it('duplicate_bad_params_is_error', async () => {
    mockFetch({ [KEY]: () => apiError(409, 'asset.duplicate') })
    const outcome = await finalizeUpload(URL_U1, [], 0)
    expect(outcome.kind).toBe('error')
  })

  it('unsupported', async () => {
    mockFetch({ [KEY]: () => apiError(400, 'upload.unsupportedType') })
    expect(await finalizeUpload(URL_U1, [], 0)).toEqual({
      kind: 'unsupported',
    })
  })

  it('lost', async () => {
    mockFetch({ [KEY]: () => apiError(404, 'upload.notFound') })
    expect(await finalizeUpload(URL_U1, [], 0)).toEqual({ kind: 'lost' })
  })

  it('other_errors_keep_key', async () => {
    mockFetch({ [KEY]: () => apiError(409, 'upload.locked') })
    const outcome = await finalizeUpload(URL_U1, [], 0)
    expect(outcome.kind === 'error' && outcome.error.key).toBe('upload.locked')
  })
})
