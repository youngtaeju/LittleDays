import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api, call } from '@/api/client'
import type { Role, User } from '@/api/types'
import { FormError } from '@/components/Field'
import { NativeSelect } from '@/components/NativeSelect'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { AdaptiveSheet } from '@/upload/AdaptiveSheet'
import { usersKey } from '@/members/useUsers'

export const EDITABLE_ROLES = ['guardian', 'family'] as const

function isEditableRole(v: string): v is (typeof EDITABLE_ROLES)[number] {
  return v === 'guardian' || v === 'family'
}

// owner 전용. 다른 멤버의 역할 변경·정지/해제.
export function MemberSheet({
  user,
  onClose,
}: {
  user: User
  onClose: () => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const suspended = user.disabled_at !== null

  const patch = useMutation({
    mutationFn: (body: { role?: Role; disabled?: boolean }) =>
      call(
        api.PATCH('/api/users/{id}', {
          params: { path: { id: user.id } },
          body,
        }),
      ),
    onSuccess: async (_d, body) => {
      await qc.invalidateQueries({ queryKey: usersKey })
      setConfirming(false)
      toast(
        body.role
          ? t('members.roleChanged')
          : body.disabled
            ? t('members.suspended')
            : t('members.unsuspended'),
      )
      if (!body.role) onClose()
    },
  })

  return (
    <AdaptiveSheet
      title={t('members.memberSheetTitle', { name: user.display_name })}
      onClose={onClose}
    >
      <div className="grid gap-4 pt-2">
        <p className="text-sm text-muted-foreground">
          @{user.username}
          {user.email ? ` · ${user.email}` : ''}
        </p>
        <div className="grid gap-2">
          <Label htmlFor="member-role">
            {t('members.roleOf', { name: user.display_name })}
          </Label>
          <NativeSelect
            id="member-role"
            value={user.role}
            disabled={patch.isPending}
            onChange={(e) => {
              const role = e.target.value
              if (isEditableRole(role)) patch.mutate({ role })
            }}
          >
            {EDITABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`roles.${r}`)}
              </option>
            ))}
          </NativeSelect>
          <p className="text-xs text-muted-foreground">
            {t(`roles.${user.role}Desc`)}
          </p>
        </div>
        <FormError error={confirming ? null : patch.error} />
        {suspended ? (
          <Button
            variant="outline"
            disabled={patch.isPending}
            onClick={() => {
              patch.mutate({ disabled: false })
            }}
          >
            {t('members.unsuspend')}
          </Button>
        ) : (
          <Button
            variant="outline"
            className="text-destructive"
            onClick={() => {
              setConfirming(true)
            }}
          >
            {t('members.suspend')}
          </Button>
        )}
      </div>
      <Dialog
        open={confirming}
        onOpenChange={(open) => {
          if (!open) {
            setConfirming(false)
            patch.reset()
          }
        }}
      >
        <DialogContent role="alertdialog">
          <DialogHeader>
            <DialogTitle>
              {t('members.suspendTitle', { name: user.display_name })}
            </DialogTitle>
            <DialogDescription>{t('members.suspendConfirm')}</DialogDescription>
          </DialogHeader>
          <FormError error={patch.error} />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setConfirming(false)
                patch.reset()
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={patch.isPending}
              onClick={() => {
                patch.mutate({ disabled: true })
              }}
            >
              {t('members.suspend')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdaptiveSheet>
  )
}
