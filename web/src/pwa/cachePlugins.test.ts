import { describe, expect, it } from 'vitest'
import { isDerivative, onlyCacheable, stripMediaToken } from './cachePlugins'

const BASE = 'http://localhost'

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
    expect(match('/api/assets/a1/large.webp')).toBe(true)
    expect(match('/api/assets/a1/original')).toBe(false)
    expect(match('/api/assets/a1/video')).toBe(false)
    expect(match('/api/assets/a1')).toBe(false)
    expect(match('/api/assets/a1/thumb.webp/x')).toBe(false)
    expect(match('/x/api/assets/a1/thumb.webp')).toBe(false)
    expect(match('/api/assets/a1/thumb.webp', false)).toBe(false)
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
  })
})
