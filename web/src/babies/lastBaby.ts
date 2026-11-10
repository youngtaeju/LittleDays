// 아기 탭 진입 시 마지막으로 본 아기. 기기별 저장.
const KEY = 'ld.baby.last'

export function loadLastBaby(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function saveLastBaby(id: string): void {
  try {
    localStorage.setItem(KEY, id)
  } catch {
    // 저장 불가(사생활 보호 모드 등)면 첫째 아기로.
  }
}

// 마지막 본 아기, 지웠거나 없으면 첫째.
export function pickBaby<T extends { id: string }>(babies: T[]): T | undefined {
  const last = loadLastBaby()
  return babies.find((b) => b.id === last) ?? babies[0]
}
