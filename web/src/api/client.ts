import createClient, { type Middleware } from 'openapi-fetch'
import type { paths } from './schema'
import { ApiError } from './errors'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

const csrf: Middleware = {
  onRequest({ request }) {
    if (!SAFE_METHODS.has(request.method)) {
      request.headers.set('X-Requested-With', 'LittleDays')
    }
    return request
  },
}

export const api = createClient<paths>({
  // 같은 origin. Node 의 Request 는 상대 URL 을 받지 않아 origin 명시.
  baseUrl: location.origin,
  credentials: 'same-origin',
  // 생성 시점에 fetch 를 캡처하지 않도록 호출 시 조회. 테스트 스텁 대응.
  fetch: (req) => globalThis.fetch(req),
})
api.use(csrf)

// 에러 응답 본문 해석. tus 응답(XHR) 공용.
export function errorBody(error: unknown): {
  key: string
  params: Record<string, unknown>
} {
  if (typeof error === 'object' && error !== null && 'error' in error) {
    const { error: key, params } = error as { error: unknown; params?: unknown }
    if (typeof key === 'string') {
      const p =
        typeof params === 'object' && params !== null
          ? (params as Record<string, unknown>)
          : {}
      return { key, params: p }
    }
  }
  return { key: 'unknown', params: {} }
}

export async function call<T>(
  p: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  let result: { data?: T; error?: unknown; response: Response }
  try {
    result = await p
  } catch (e) {
    if (e instanceof TypeError) throw new ApiError(0, 'network.offline', {})
    throw e
  }
  const { data, error, response } = result
  if (!response.ok) {
    const b = errorBody(error)
    throw new ApiError(response.status, b.key, b.params)
  }
  return data as T
}
