// 아기 2명 이상일 때 업로드 확인의 기본 선택. 기기별 저장.
const KEY = 'ld.upload.babies'

// existing = 현재 아기 ID. 지운 아기는 제외.
export function loadLastBabies(existing: readonly string[]): string[] {
  let saved: unknown
  try {
    saved = JSON.parse(localStorage.getItem(KEY) ?? '[]')
  } catch {
    return []
  }
  if (!Array.isArray(saved)) return []
  return (saved as unknown[]).filter(
    (id): id is string => typeof id === 'string' && existing.includes(id),
  )
}

export function saveLastBabies(ids: readonly string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids))
  } catch {
    // 저장 불가(사생활 보호 모드 등)면 다음에 기본값 없음.
  }
}
