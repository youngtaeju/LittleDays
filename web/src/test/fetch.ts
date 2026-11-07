import { vi } from 'vitest'

type Handler = (req: Request) => Response | Promise<Response>

const unmatched: string[] = []

// 미등록 요청 기록. 앱이 throw 를 삼켜도 setup.ts 가 테스트를 실패시킴.
export function takeUnmatchedRequests(): string[] {
  return unmatched.splice(0)
}

// 키 형식 "GET /api/auth/me". 미등록 경로는 throw.
export function mockFetch(routes: Record<string, Handler>): void {
  vi.stubGlobal(
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const req =
        input instanceof Request
          ? input
          : new Request(new URL(String(input), 'http://localhost'), init)
      const key = `${req.method} ${new URL(req.url).pathname}`
      const handler = routes[key]
      if (!handler) {
        unmatched.push(key)
        throw new Error(`mockFetch: 등록되지 않은 요청 ${key}`)
      }
      return handler(req)
    },
  )
}

export function json(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
