import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api, call } from '@/api/client'
import type { Role } from '@/api/types'
import { FormError } from '@/components/Field'
import { SelectField } from '@/components/NativeSelect'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useSettings } from '@/settings/useSettings'
import { AdaptiveSheet } from '@/upload/AdaptiveSheet'

export const invitesKey = ['invites'] as const
const INVITE_ROLES = ['guardian', 'family'] as const
const EXPIRY_HOURS = [24, 72, 168] as const

function isInviteRole(v: string): v is (typeof INVITE_ROLES)[number] {
  return v === 'guardian' || v === 'family'
}

export function InviteSheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const settings = useSettings()
  const urlInput = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [copyFailed, setCopyFailed] = useState(false)

  async function copy(link: string, silent = false) {
    try {
      await navigator.clipboard.writeText(link)
      setCopyFailed(false)
      toast(silent ? t('members.linkCopied') : t('common.copied'))
    } catch {
      setCopyFailed(true)
      urlInput.current?.select()
    }
  }

  // 공유 시트 우선. 사용자 취소(AbortError)는 무시, 미지원·그 외 실패는 복사.
  async function share(link: string) {
    const instance = settings?.instance_name ?? ''
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: t('members.shareTitle', { instance }),
          text: t('members.shareText', { instance }),
          url: link,
        })
        return
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
      }
    }
    await copy(link, true)
  }

  const create = useMutation({
    mutationFn: (body: { role: Role; expires_in_hours: number }) =>
      call(api.POST('/api/invites', { body })),
    onSuccess: async (res) => {
      setUrl(res.url)
      await qc.invalidateQueries({ queryKey: invitesKey })
      await share(res.url)
    },
  })

  return (
    <AdaptiveSheet title={t('members.inviteSheetTitle')} onClose={onClose}>
      <div className="grid gap-4 pt-2">
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            const form = new FormData(e.currentTarget)
            const role = form.get('role')
            const hours = Number(form.get('hours'))
            if (typeof role === 'string' && isInviteRole(role)) {
              create.mutate({ role, expires_in_hours: hours })
            }
          }}
        >
          <SelectField
            label={t('members.inviteRole')}
            name="role"
            defaultValue="family"
          >
            {INVITE_ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`roles.${r}`)} · {t(`roles.${r}Desc`)}
              </option>
            ))}
          </SelectField>
          <SelectField
            label={t('members.inviteExpiry')}
            name="hours"
            defaultValue="72"
          >
            {EXPIRY_HOURS.map((h) => (
              <option key={h} value={h}>
                {t(`members.expiry.${String(h)}`)}
              </option>
            ))}
          </SelectField>
          <Button type="submit" disabled={create.isPending}>
            {t('members.createInvite')}
          </Button>
        </form>
        <FormError error={create.error} />
        {url !== null && (
          <div className="grid gap-2 rounded-xl bg-muted p-3">
            <label htmlFor="invite-url" className="text-sm font-semibold">
              {t('members.inviteUrl')}
            </label>
            <div className="flex gap-2">
              <Input
                id="invite-url"
                ref={urlInput}
                readOnly
                value={url}
                onFocus={(e) => {
                  e.currentTarget.select()
                }}
              />
              <Button variant="outline" onClick={() => void copy(url)}>
                {t('common.copy')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('members.inviteUrlHint')}
            </p>
            {copyFailed && (
              <p role="alert" className="text-sm text-destructive">
                {t('members.copyFailed')}
              </p>
            )}
          </div>
        )}
      </div>
    </AdaptiveSheet>
  )
}
