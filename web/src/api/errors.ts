export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly key: string,
    readonly params: Record<string, unknown>,
  ) {
    super(key)
    this.name = 'ApiError'
  }
}

// 401 중 세션 상실만 로그아웃. 로그인/비밀번호 변경 실패(auth.invalidCredentials)는 폼 에러.
export function isLogoutError(e: unknown): boolean {
  return (
    e instanceof ApiError &&
    e.status === 401 &&
    (e.key === 'auth.required' || e.key === 'auth.disabled')
  )
}
