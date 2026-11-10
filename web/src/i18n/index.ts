import i18next, { type TFunction } from 'i18next'
import { initReactI18next } from 'react-i18next'
import { ApiError } from '@/api/errors'
import en from '@/locales/en.json'
import ko from '@/locales/ko.json'

export type Locale = 'ko' | 'en'

function isLocale(v: string | null | undefined): v is Locale {
  return v === 'ko' || v === 'en'
}

const LANG_KEY = 'ld.lang'

// 로그인 전 선택 언어(기기 저장). 저장소 접근 불가 시 없음으로 취급.
function storedLocale(): Locale | null {
  try {
    const v = localStorage.getItem(LANG_KEY)
    return isLocale(v) ? v : null
  } catch {
    return null
  }
}

// 로그인 전 화면에서 고른 언어 저장 후 적용.
export function chooseLocale(lng: Locale): void {
  try {
    localStorage.setItem(LANG_KEY, lng)
  } catch {
    // 저장 실패 시 이번 방문에만 적용.
  }
  initI18n(lng)
}

export function pickLocale(
  userLocale: string | null | undefined,
  navigatorLanguage: string,
): Locale {
  if (isLocale(userLocale)) return userLocale
  const stored = storedLocale()
  if (stored) return stored
  return navigatorLanguage.toLowerCase().startsWith('ko') ? 'ko' : 'en'
}

export function initI18n(lng: Locale): void {
  if (i18next.isInitialized) {
    void i18next.changeLanguage(lng)
    return
  }
  // 스크린리더 발음·브라우저 번역 판단용.
  i18next.on('languageChanged', (l) => {
    document.documentElement.lang = l
  })
  void i18next.use(initReactI18next).init({
    lng,
    fallbackLng: 'en',
    resources: { ko: { translation: ko }, en: { translation: en } },
    interpolation: { escapeValue: false },
  })
}

// 사용자 언어 적용. null = 비로그인(브라우저 언어). 같은 언어면 재렌더 없음.
export function applyUserLocale(userLocale: string | null): void {
  // 초기화 전(i18n 없는 단위 테스트 등)은 적용 대상 없음.
  if (!i18next.isInitialized) return
  const lng = pickLocale(userLocale, navigator.language)
  if (i18next.language !== lng) void i18next.changeLanguage(lng)
}

export function errorMessage(t: TFunction, e: unknown): string {
  if (e instanceof ApiError) {
    // 빈 defaultValue 로 누락 키 감지.
    const msg = t(`errors.${e.key}`, { ...e.params, defaultValue: '' })
    if (msg) return msg
  }
  return t('errors.unknown')
}
