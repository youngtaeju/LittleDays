import { useRouterState } from '@tanstack/react-router'
import IconAdd from '~icons/material-symbols/add-rounded'
import { useTranslation } from 'react-i18next'
import { hasRole, useMe } from '@/auth/session'

// 떠 있는 (+) 화면: 홈, 달력, 앨범 탭, 아기 화면(하위 주소 제외).
const FAB_PATH = /^\/(calendar|albums|babies\/[^/]+)?$/

// 보호자 이상 && 떠 있는 (+) 화면. 셸의 본문 아래 여백, 알약 정렬 공용.
export function useShowsFab(): boolean {
  const { user } = useMe()
  const onFabPath = useRouterState({
    select: (s) => FAB_PATH.test(s.location.pathname),
  })
  return hasRole(user, 'guardian') && onFabPath
}

// 1024px 미만 탭 바(56px) 위 오른쪽 56px 강조 원 (+). 표시 조건은 셸(useShowsFab). 사진 진행 상황은 업로드 알약.
export function AddFab({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation()
  return (
    <div
      data-testid="add-fab"
      className="fixed right-4 bottom-[calc(56px+12px+env(safe-area-inset-bottom))] z-20 lg:hidden"
    >
      <button
        type="button"
        aria-label={t('addSheet.open')}
        aria-haspopup="dialog"
        onClick={onClick}
        className="grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg"
      >
        <IconAdd aria-hidden className="size-8" />
      </button>
    </div>
  )
}
