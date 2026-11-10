// 서비스 워커 런타임 캐시 콜백. generateSW 가 함수 소스를 sw.js 에 그대로 직렬화.
// 본문은 자기 완결 필수: import·바깥 변수·다른 함수 참조 금지.

// 파생물 중 썸네일·미리보기만. 큰 이미지(확대 전용)·원본·영상은 캐시 안 함.
export function isDerivative({
  url,
  sameOrigin,
}: {
  url: URL
  sameOrigin: boolean
}): boolean {
  return (
    sameOrigin &&
    /^\/api\/assets\/[^/]+\/(thumb|preview)\.(webp|avif)$/.test(url.pathname)
  )
}

// 오프라인 새로고침용 GET 응답(사용자·설정·아기·타임라인·자산 상세). 쿼리 포함 URL 이 키.
// 메서드 판정은 라우트 쪽(GET 기본값). 파일·업로드·관리 화면 API 는 제외.
export function isOfflineApi({
  url,
  sameOrigin,
}: {
  url: URL
  sameOrigin: boolean
}): boolean {
  return (
    sameOrigin &&
    /^\/api\/(auth\/me|settings|babies|assets(\/(months|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))?)$/i.test(
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

// 자체 서빙 글꼴(Pretendard 서브셋). 파일명 해시라 CacheFirst.
export function isFont({
  url,
  sameOrigin,
}: {
  url: URL
  sameOrigin: boolean
}): boolean {
  return sameOrigin && /\.woff2$/.test(url.pathname)
}
