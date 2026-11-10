import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'

const RESET_COMMAND =
  'docker compose exec app /app/littledays reset-password <아이디>'

// 이메일 발송이 없으므로 관리자 요청 안내와 서버 명령 표시.
export function ForgotPasswordSheet() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(RESET_COMMAND)
      toast(t('common.copied'))
    } catch {
      // 클립보드 거부 시 사용자가 직접 선택해 복사.
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" variant="link" className="justify-self-start">
          {t('auth.login.forgot')}
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="mx-auto max-w-[400px]">
        <SheetHeader>
          <SheetTitle>{t('auth.login.forgotTitle')}</SheetTitle>
          <SheetDescription>{t('auth.login.forgotAskAdmin')}</SheetDescription>
        </SheetHeader>
        <div className="grid gap-2 px-4 pb-6">
          <p className="text-sm text-muted-foreground">
            {t('auth.login.forgotAdmin')}
          </p>
          <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs">
            <code>{RESET_COMMAND}</code>
          </pre>
          <Button type="button" variant="outline" onClick={() => void copy()}>
            {t('common.copy')}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
