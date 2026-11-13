import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Field, FormError } from '@/components/Field'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { usePortalTheme } from '@/lib/portalTheme'
import { useBrowserOnline } from '@/pwa/OfflineBanner'
import { cn } from '@/lib/utils'

// 앨범 이름 입력. 새 앨범, 이름 바꾸기 공용. 길이(1~50자), 공백 정리는 서버 검증.
// 닫히면 내용 해제. 다시 열면 initialName 부터. 테마는 포털 테마(뷰어 위면 어둡게).
export function AlbumNameDialog({
  open,
  onOpenChange,
  title,
  submitLabel,
  initialName = '',
  pending,
  error,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  submitLabel: string
  initialName?: string
  pending: boolean
  error: unknown
  onSubmit: (name: string) => void
}) {
  const theme = usePortalTheme()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className={cn(theme, theme && 'text-foreground')}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <NameForm
          initialName={initialName}
          submitLabel={submitLabel}
          pending={pending}
          error={error}
          onCancel={() => {
            onOpenChange(false)
          }}
          onSubmit={onSubmit}
        />
      </DialogContent>
    </Dialog>
  )
}

function NameForm({
  initialName,
  submitLabel,
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  initialName: string
  submitLabel: string
  pending: boolean
  error: unknown
  onCancel: () => void
  onSubmit: (name: string) => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(initialName)
  const online = useBrowserOnline()
  const blocked = name.trim() === '' || pending || !online
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!blocked) onSubmit(name)
      }}
    >
      <Field
        label={t('albums.nameLabel')}
        value={name}
        autoFocus
        autoComplete="off"
        onChange={(e) => {
          setName(e.target.value)
        }}
      />
      <FormError error={error} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={blocked}>
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}
