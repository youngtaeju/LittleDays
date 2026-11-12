// 이야기 상세 쿼리 키. 하트 즉시 반영, 댓글 뒤 재조회 대상.
export function storyKey(id: string) {
  return ['story', id] as const
}
