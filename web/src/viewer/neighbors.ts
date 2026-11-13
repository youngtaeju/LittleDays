import type { Asset, AssetSummary } from '@/api/types'

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

// 다음 페이지를 받아도 목록에 나올 수 없는 항목. 페이지 순회 중단 판단용.
// kind: 영상 목록이면 사진은 목록 밖.
export function outsideTimeline(
  detail: Pick<Asset, 'deleted_at' | 'taken_at' | 'baby_ids' | 'kind'>,
  last: Pick<AssetSummary, 'taken_at'> | undefined,
  baby: string | undefined,
  kind?: 'video',
): boolean {
  if (detail.deleted_at) return true
  if (baby && !detail.baby_ids.includes(baby)) return true
  if (kind && detail.kind !== kind) return true
  // 목록은 촬영 시각 내림차순. 마지막 항목보다 새로우면 이미 지나침. 같은 시각은 id 순이라 계속.
  return (
    last !== undefined &&
    Date.parse(detail.taken_at) > Date.parse(last.taken_at)
  )
}
