import { describe, expect, it } from 'vitest'
import {
  isDerivative,
  isFont,
  isOfflineApi,
  onlyCacheable,
  stripMediaToken,
} from './cachePlugins'

const BASE = 'http://localhost'
const ID = '0b9f6a52-3c1d-4e8a-9f00-1a2b3c4d5e6f'

function res(status: number, cacheControl?: string): Response {
  return new Response(status === 204 ? null : 'x', {
    status,
    headers: cacheControl ? { 'Cache-Control': cacheControl } : {},
  })
}

// generateSW 가 sw.js 에 넣는 형태(함수 소스 문자열)로 다시 생성. 전역 스코프라 바깥 참조 시 실패.
function revive<F>(fn: F): F {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const make = new Function(`return (${String(fn)})`) as () => F
  return make()
}

describe('cachePlugins', () => {
  it('strips_t_only', async () => {
    const strip = async (path: string) =>
      stripMediaToken({ request: new Request(BASE + path) })
    expect(await strip('/api/assets/a/thumb.webp?t=x&v=1')).toBe(
      `${BASE}/api/assets/a/thumb.webp?v=1`,
    )
    expect(await strip('/api/assets/a/thumb.webp?t=x')).toBe(
      `${BASE}/api/assets/a/thumb.webp`,
    )
    expect(await strip('/api/assets/a/thumb.webp')).toBe(
      `${BASE}/api/assets/a/thumb.webp`,
    )
  })

  it('skips_no_store', async () => {
    expect(await onlyCacheable({ response: res(200, 'no-store') })).toBeNull()
    expect(
      await onlyCacheable({ response: res(200, 'private, no-store') }),
    ).toBeNull()
    const ok = res(200, 'private, max-age=86400')
    expect(await onlyCacheable({ response: ok })).toBe(ok)
    expect(await onlyCacheable({ response: res(404) })).toBeNull()
    expect(await onlyCacheable({ response: res(206) })).toBeNull()
  })

  it('matches_derivative_paths_only', () => {
    const match = (path: string, sameOrigin = true) =>
      isDerivative({ url: new URL(BASE + path), sameOrigin })
    expect(match('/api/assets/a1/thumb.webp')).toBe(true)
    expect(match('/api/assets/a1/preview.avif?t=x')).toBe(true)
    expect(match('/api/assets/a1/original')).toBe(false)
    expect(match('/api/assets/a1/video')).toBe(false)
    expect(match('/api/assets/a1')).toBe(false)
    expect(match('/api/assets/a1/thumb.webp/x')).toBe(false)
    expect(match('/x/api/assets/a1/thumb.webp')).toBe(false)
    expect(match('/api/assets/a1/thumb.webp', false)).toBe(false)
  })

  // 큰 이미지는 확대 전용. 용량 대비 오프라인 효용 낮음.
  it('derivative_excludes_large', () => {
    const match = (path: string) =>
      isDerivative({ url: new URL(BASE + path), sameOrigin: true })
    expect(match('/api/assets/a1/large.webp')).toBe(false)
    expect(match('/api/assets/a1/large.avif')).toBe(false)
    expect(match('/api/assets/a1/thumb.avif')).toBe(true)
  })

  it('is_offline_api', () => {
    const match = (path: string, sameOrigin = true) =>
      isOfflineApi({ url: new URL(BASE + path), sameOrigin })
    expect(match('/api/auth/me')).toBe(true)
    expect(match('/api/settings')).toBe(true)
    expect(match('/api/babies')).toBe(true)
    expect(match('/api/days')).toBe(true)
    expect(match('/api/days?limit=20&cursor=2024-05-10&baby_id=b1')).toBe(true)
    expect(match('/api/days/2024-05-09')).toBe(true)
    expect(match('/api/days/2024-05-09?baby_id=b1')).toBe(true)
    expect(match('/api/days/x')).toBe(false)
    expect(match('/api/days/2024-05-09/x')).toBe(false)
    expect(match('/api/assets')).toBe(true)
    expect(match('/api/assets?limit=100&cursor=c1&baby_id=b1')).toBe(true)
    expect(match('/api/assets/months?baby_id=b1')).toBe(true)
    expect(match(`/api/assets/${ID}`)).toBe(true)
    expect(match(`/api/assets/${ID.toUpperCase()}`)).toBe(true)

    expect(match(`/api/assets/${ID}/thumb.webp`)).toBe(false)
    expect(match(`/api/assets/${ID}/original`)).toBe(false)
    expect(match(`/api/assets/${ID}/video`)).toBe(false)
    expect(match(`/api/assets/${ID}/retry`)).toBe(false)
    expect(match(`/api/assets/${ID}/babies`)).toBe(false)
    expect(match('/api/assets/x')).toBe(false)
    expect(match('/api/assets/')).toBe(false)
    expect(match('/api/uploads')).toBe(false)
    expect(match(`/api/uploads/${ID}`)).toBe(false)
    expect(match('/api/babies/order')).toBe(false)
    expect(match('/api/auth/logout')).toBe(false)
    expect(match('/api/auth/media-token')).toBe(false)
    expect(match('/api/auth/sessions')).toBe(false)
    expect(match('/api/trash')).toBe(false)
    expect(match('/api/daysx')).toBe(false)
    expect(match('/api/users')).toBe(false)
    expect(match('/x/api/babies')).toBe(false)
    expect(match('/api/babies', false)).toBe(false)
  })

  // 글꼴은 precache 대신 런타임 캐시(vite.config.ts globIgnores). 빌드 sw.js 확인은 수동.
  it('fonts_not_precached', () => {
    const match = (path: string, sameOrigin = true) =>
      isFont({ url: new URL(BASE + path), sameOrigin })
    expect(match('/assets/PretendardVariable.subset.12-a1B2c3.woff2')).toBe(
      true,
    )
    expect(match('/assets/index-a1B2c3.css')).toBe(false)
    expect(match('/assets/x.woff2.js')).toBe(false)
    expect(match('/api/assets/a1/thumb.webp')).toBe(false)
    expect(match('/assets/x.woff2', false)).toBe(false)
  })

  it('self_contained', async () => {
    const strip = revive(stripMediaToken)
    expect(
      await strip({
        request: new Request(`${BASE}/api/assets/a/thumb.webp?t=x&v=1`),
      }),
    ).toBe(`${BASE}/api/assets/a/thumb.webp?v=1`)

    const cacheable = revive(onlyCacheable)
    expect(await cacheable({ response: res(200, 'no-store') })).toBeNull()
    const ok = res(200, 'private, max-age=86400')
    expect(await cacheable({ response: ok })).toBe(ok)

    const derivative = revive(isDerivative)
    expect(
      derivative({
        url: new URL(`${BASE}/api/assets/a/thumb.webp`),
        sameOrigin: true,
      }),
    ).toBe(true)

    const offlineApi = revive(isOfflineApi)
    expect(
      offlineApi({
        url: new URL(`${BASE}/api/assets/${ID}`),
        sameOrigin: true,
      }),
    ).toBe(true)
    expect(
      offlineApi({ url: new URL(`${BASE}/api/uploads`), sameOrigin: true }),
    ).toBe(false)

    const font = revive(isFont)
    expect(
      font({ url: new URL(`${BASE}/assets/a.woff2`), sameOrigin: true }),
    ).toBe(true)
  })
})
