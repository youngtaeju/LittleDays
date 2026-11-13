import { useCanGoBack, useRouter } from '@tanstack/react-router'
import IconBack from '~icons/material-symbols/arrow-back-rounded'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

// 나 탭, 앨범 탭 하위 화면 공통 틀. 셸 머리글을 대신해 뒤로(기록 있으면 되돌아가기, 직접 진입이면 backTo) + 제목 + 오른쪽 actions.
export function MeSubPage({
  title,
  actions,
  backTo = '/me',
  children,
}: {
  title: string
  actions?: ReactNode
  backTo?: '/me' | '/albums'
  children: ReactNode
}) {
  const { t } = useTranslation()
  const router = useRouter()
  const canGoBack = useCanGoBack()
  return (
    // 열 최소 폭 0. 말줄임 제목(nowrap)의 글자 폭만큼 열이 넓어지지 않게.
    <div className="-mt-4 grid grid-cols-1 gap-4">
      <header className="sticky top-0 z-10 -mx-4 flex min-h-14 items-center gap-1 bg-background px-2 py-1">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('me.back')}
          onClick={() => {
            if (canGoBack) router.history.back()
            else void router.navigate({ to: backTo, replace: true })
          }}
        >
          <IconBack aria-hidden className="size-6" />
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-lg font-bold">{title}</h1>
        {actions}
      </header>
      {children}
    </div>
  )
}
