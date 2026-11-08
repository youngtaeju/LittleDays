import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api, call } from '@/api/client'
import type { Role, User } from '@/api/types'
import { useMe } from '@/auth/session'
import { FormError } from '@/components/Field'
import { NativeSelect, SelectField } from '@/components/NativeSelect'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useSettings } from '@/settings/useSettings'
import { formatInZone } from '@/viewer/zoned'

const usersKey = ['users'] as const
const invitesKey = ['invites'] as const
const INVITE_ROLES = ['guardian', 'family'] as const
const EXPIRY_HOURS = [24, 72, 168] as const

function isInviteRole(v: string): v is (typeof INVITE_ROLES)[number] {
  return v === 'guardian' || v === 'family'
}

function UserRow({ user, self }: { user: User; self: boolean }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const editable = user.role !== 'owner' && !self
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
    },
  })

  return (
    <li className="grid gap-2 rounded-md border border-border bg-card p-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 basis-40 truncate font-semibold">
          {user.display_name}
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            @{user.username}
          </span>
        </p>
        {suspended && (
          <span className="text-sm font-semibold text-destructive">
            {t('members.disabled')}
          </span>
        )}
        {editable ? (
          <NativeSelect
            className="w-auto"
            aria-label={t('members.roleOf', { name: user.display_name })}
            value={user.role}
            disabled={patch.isPending}
            onChange={(e) => {
              const role = e.target.value
              if (isInviteRole(role)) patch.mutate({ role })
            }}
          >
            {INVITE_ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`roles.${r}`)}
              </option>
            ))}
          </NativeSelect>
        ) : (
          <span className="text-sm text-muted-foreground">
            {t(`roles.${user.role}`)}
          </span>
        )}
        {editable &&
          (suspended ? (
            <Button
              variant="outline"
              size="sm"
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
              size="sm"
              onClick={() => {
                setConfirming(true)
              }}
            >
              {t('members.suspend')}
            </Button>
          ))}
      </div>
      <p className="text-sm text-muted-foreground">
        {user.email ?? t('members.noEmail')}
      </p>
      <FormError error={confirming ? null : patch.error} />
      <Dialog
        open={confirming}
        onOpenChange={(open) => {
          if (!open) {
            setConfirming(false)
            patch.reset()
          }
        }}
      >
        <DialogContent>
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
    </li>
  )
}

function InviteCreator() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const urlInput = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [copyFailed, setCopyFailed] = useState(false)

  const create = useMutation({
    mutationFn: (body: { role: Role; expires_in_hours: number }) =>
      call(api.POST('/api/invites', { body })),
    onSuccess: async (res) => {
      setUrl(res.url)
      setCopyFailed(false)
      toast(t('members.inviteCreated'))
      await qc.invalidateQueries({ queryKey: invitesKey })
    },
  })

  async function copy() {
    if (url === null) return
    try {
      await navigator.clipboard.writeText(url)
      setCopyFailed(false)
      toast(t('common.copied'))
    } catch {
      setCopyFailed(true)
      urlInput.current?.select()
    }
  }

  return (
    <div className="grid gap-3">
      <form
        className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
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
              {t(`roles.${r}`)}
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
        <div className="grid gap-2 rounded-md border border-border bg-card p-3">
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
            <Button variant="outline" onClick={() => void copy()}>
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
  )
}

function InviteList() {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const settings = useSettings()
  const invites = useQuery({
    queryKey: invitesKey,
    queryFn: () => call(api.GET('/api/invites')),
  })
  const revoke = useMutation({
    mutationFn: (id: string) =>
      call(api.DELETE('/api/invites/{id}', { params: { path: { id } } })),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: invitesKey })
      toast(t('members.revoked'))
    },
  })
  const list = invites.data?.invites ?? []

  return (
    <div className="grid gap-2">
      <FormError error={invites.error ?? revoke.error} />
      {invites.isSuccess && list.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {t('members.noInvites')}
        </p>
      )}
      <ul className="grid gap-2">
        {list.map((invite) => {
          const expires = settings
            ? t('members.expiresAt', {
                time: formatInZone(
                  invite.expires_at,
                  settings.timezone,
                  i18n.language,
                ),
              })
            : null
          return (
            <li
              key={invite.id}
              className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card p-3"
            >
              <span className="font-semibold">{t(`roles.${invite.role}`)}</span>
              <span className="text-sm text-muted-foreground">
                {t(`members.inviteStatus.${invite.status}`)}
              </span>
              {expires && (
                <span className="min-w-0 flex-1 text-sm text-muted-foreground">
                  {expires}
                </span>
              )}
              {invite.status === 'active' && (
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={[
                    t('members.revokeLabel', {
                      role: t(`roles.${invite.role}`),
                    }),
                    expires,
                  ]
                    .filter((v) => v != null)
                    .join(', ')}
                  disabled={revoke.isPending}
                  onClick={() => {
                    revoke.mutate(invite.id)
                  }}
                >
                  {t('members.revoke')}
                </Button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function MembersPage() {
  const { t } = useTranslation()
  const { user: me } = useMe()
  const users = useQuery({
    queryKey: usersKey,
    queryFn: () => call(api.GET('/api/users')),
  })

  return (
    <div className="mx-auto grid max-w-xl gap-6">
      <section aria-labelledby="members-users" className="grid gap-3">
        <h1 id="members-users" className="text-lg font-semibold">
          {t('members.usersTitle')}
        </h1>
        <FormError error={users.error} />
        <ul className="grid gap-2">
          {users.data?.users.map((u) => (
            <UserRow key={u.id} user={u} self={u.id === me?.id} />
          ))}
        </ul>
      </section>
      <section aria-labelledby="members-invites" className="grid gap-3">
        <h2 id="members-invites" className="text-lg font-semibold">
          {t('members.invitesTitle')}
        </h2>
        <InviteCreator />
        <InviteList />
      </section>
    </div>
  )
}
