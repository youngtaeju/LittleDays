import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { isLogoutError } from '@/api/errors'
import { errorMessage } from '@/i18n'
import { useLogout } from './session'

export function useSignOut(): () => Promise<void> {
  const { t } = useTranslation()
  const logout = useLogout()
  const navigate = useNavigate()
  return async () => {
    try {
      await logout()
      await navigate({ to: '/login' })
    } catch (e) {
      // 세션 상실은 전역 처리에서 로그인 화면으로 이동.
      if (!isLogoutError(e)) toast.error(errorMessage(t, e))
    }
  }
}
