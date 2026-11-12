import { createContext, useContext } from 'react'

// 포털로 그리는 시트, 메뉴, 대화상자의 테마 클래스. 뷰어는 앱 테마와 무관하게 'dark', 그 밖은 앱 테마.
export const PortalThemeContext = createContext<'dark' | undefined>(undefined)

export function usePortalTheme(): 'dark' | undefined {
  return useContext(PortalThemeContext)
}
