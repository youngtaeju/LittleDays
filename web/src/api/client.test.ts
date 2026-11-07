import { describe, expect, it } from 'vitest'
import { api, call } from './client'
import { ApiError } from './errors'
import { json, mockFetch } from '@/test/fetch'

describe('api client', () => {
  it('adds_csrf_header_on_mutations', async () => {
    const seen: Record<string, string | null> = {}
    mockFetch({
      'POST /api/auth/logout': (req) => {
        seen.post = req.headers.get('X-Requested-With')
        return json(204, null)
      },
      'GET /api/auth/me': (req) => {
        seen.get = req.headers.get('X-Requested-With')
        return json(401, { error: 'auth.required', params: {} })
      },
    })
    await call(api.POST('/api/auth/logout'))
    await call(api.GET('/api/auth/me')).catch(() => undefined)
    expect(seen.post).toBe('LittleDays')
    expect(seen.get).toBeNull()
  })

  it('call_throws_api_error_with_key', async () => {
    mockFetch({
      'GET /api/auth/me': () =>
        json(409, {
          error: 'asset.duplicate',
          params: { asset_id: 'a', in_trash: true },
        }),
    })
    const err = await call(api.GET('/api/auth/me')).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({
      status: 409,
      key: 'asset.duplicate',
      params: { asset_id: 'a', in_trash: true },
    })
  })

  it('network_failure_maps_to_offline', async () => {
    mockFetch({
      'GET /api/auth/me': () => {
        throw new TypeError('Failed to fetch')
      },
    })
    const err = await call(api.GET('/api/auth/me')).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 0, key: 'network.offline', params: {} })
  })
})
