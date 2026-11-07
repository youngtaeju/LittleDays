// 타임라인 캐시 순서 기준 이웃. 목록에 없으면 둘 다 없음.
export function neighbors(
  ids: string[],
  id: string,
): { prev?: string; next?: string } {
  const i = ids.indexOf(id)
  if (i < 0) return {}
  return {
    ...(i > 0 && { prev: ids[i - 1] }),
    ...(i < ids.length - 1 && { next: ids[i + 1] }),
  }
}
