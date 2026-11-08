// 서비스 워커 런타임 캐시 콜백. generateSW 가 함수 소스를 sw.js 에 그대로 직렬화.
// 본문은 자기 완결 필수: import·바깥 변수·다른 함수 참조 금지.

// 파생물(썸네일·미리보기·큰 이미지)만. 원본·영상·나머지 /api 는 캐시 안 함.
export function isDerivative({
  url,
  sameOrigin,
}: {
  url: URL
  sameOrigin: boolean
}): boolean {
  return (
    sameOrigin &&
    /^\/api\/assets\/[^/]+\/(thumb|preview|large)\.(webp|avif)$/.test(
      url.pathname,
    )
  )
}

// 캐시 키에서 media token(t) 제외. 토큰이 바뀌어도 같은 항목.
export function stripMediaToken({
  request,
}: {
  request: Request
}): Promise<string> {
  const url = new URL(request.url)
  url.searchParams.delete('t')
  return Promise.resolve(url.href)
}

// 처리 중 응답(no-store)·부분 응답·에러는 저장 안 함.
export function onlyCacheable({
  response,
}: {
  response: Response
}): Promise<Response | null> {
  const cc = response.headers.get('Cache-Control') ?? ''
  return Promise.resolve(
    response.status === 200 && !/(^|[\s,])no-store\b/i.test(cc)
      ? response
      : null,
  )
}
