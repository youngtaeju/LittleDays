import { useSyncExternalStore } from 'react'

export type ThemePref = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'ld.theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

export function applyTheme(p: ThemePref, systemDark: boolean): void {
  const dark = p === 'dark' || (p === 'system' && systemDark)
  document.documentElement.classList.toggle('dark', dark)
}

// 모듈 단위 단일 상태. 훅 인스턴스 간 공유, 적용 지점 하나.
let pref: ThemePref = 'system'
let systemDark = false
let initialized = false
const listeners = new Set<() => void>()

function notify(): void {
  applyTheme(pref, systemDark)
  listeners.forEach((l) => {
    l()
  })
}

// 앱 시작 시 1회. 첫 렌더 전에 호출하면 라이트 깜빡임 없음.
export function initTheme(): void {
  if (initialized) return
  initialized = true
  pref = getThemePref()
  const mq = window.matchMedia(DARK_QUERY)
  systemDark = mq.matches
  mq.addEventListener('change', (e) => {
    systemDark = e.matches
    notify()
  })
  applyTheme(pref, systemDark)
}

export function setThemePref(p: ThemePref): void {
  initTheme()
  try {
    localStorage.setItem(STORAGE_KEY, p)
  } catch {
    // 저장 불가 환경(사생활 보호 모드 등). 이번 세션에만 적용.
  }
  pref = p
  notify()
}

function subscribe(l: () => void): () => void {
  initTheme()
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

function getSnapshot(): ThemePref {
  initTheme()
  return pref
}

export function useTheme(): [ThemePref, (p: ThemePref) => void] {
  return [useSyncExternalStore(subscribe, getSnapshot), setThemePref]
}
