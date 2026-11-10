import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api, call } from '@/api/client'
import type { User } from '@/api/types'
import { hasRole, useMe } from '@/auth/session'
import { FormError } from '@/components/Field'
import { Button } from '@/components/ui/button'
import { useUsers } from '@/members/useUsers'
import { useSettings } from '@/settings/useSettings'
import { formatInZone } from '@/viewer/zoned'
import { InviteSheet, invitesKey } from './InviteSheet'
import { MemberSheet } from './MemberSheet'

const ROLES = ['owner', 'guardian', 'family'] as const

function MemberRow({
  user,
  self,
  manage,
  onOpen,
}: {
  user: User
  self: boolean
  manage: boolean
  onOpen: () => void
}) {
  const { t } = useTranslation()
  const editable = manage && user.role !== 'owner' && !self
  const initial = Array.from(user.display_name)[0] ?? '?'
  const body = (
    <>
      <span
        aria-hidden
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft font-bold text-accent-ink"
      >
        {initial}
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5 text-left">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[15px] font-semibold">
            {user.display_name}
          </span>
          {self && (
            <span className="shrink-0 text-xs text-muted-foreground">
              {t('members.self')}
            </span>
          )}
        </span>
        {/* 서버가 owner 와 본인에게만 이메일을 줌. */}
        {(manage || self) && (
          <span className="truncate text-[13px] text-muted-foreground">
            {user.email ?? t('members.noEmail')}
          </span>
        )}
      </span>
      {user.disabled_at !== null && (
        <span className="shrink-0 text-xs font-semibold text-destructive">
          {t('members.disabled')}
        </span>
      )}
      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">
        {t(`roles.${user.role}`)}
      </span>
    </>
  )
  return (
    <li className="border-b border-border last:border-b-0">
      {editable ? (
        <button
          type="button"
          className="flex min-h-14 w-full items-center gap-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-ring"
          onClick={onOpen}
        >
          {body}
        </button>
      ) : (
        <div className="flex min-h-14 items-center gap-3 py-2">{body}</div>
      )}
    </li>
  )
}

function PendingInvites() {
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
    <section aria-labelledby="family-invites" className="grid gap-2">
      <h2 id="family-invites" className="text-[17px] font-semibold">
        {t('members.invitesTitle')}
      </h2>
      <FormError error={invites.error ?? revoke.error} />
      {invites.isSuccess && list.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {t('members.noInvites')}
        </p>
      )}
      <ul>
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
              className="flex min-h-14 flex-wrap items-center gap-2 border-b border-border py-2 last:border-b-0"
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
    </section>
  )
}

export function FamilyPage() {
  const { t } = useTranslation()
  const { user: me } = useMe()
  const manage = hasRole(me, 'owner')
  const users = useUsers()
  const [inviting, setInviting] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  // 목록 갱신을 따라가도록 id 로 보관.
  const editUser = users.data?.users.find((u) => u.id === editing)

  return (
    <div className="mx-auto grid max-w-xl gap-6">
      <section aria-labelledby="family-members" className="grid gap-2">
        <div className="flex items-center justify-between gap-3">
          <h1 id="family-members" className="text-xl font-bold">
            {t('members.usersTitle')}
          </h1>
          {manage && (
            <Button
              onClick={() => {
                setInviting(true)
              }}
            >
              {t('members.inviteMember')}
            </Button>
          )}
        </div>
        <FormError error={users.error} />
        <ul>
          {users.data?.users.map((u) => (
            <MemberRow
              key={u.id}
              user={u}
              self={u.id === me?.id}
              manage={manage}
              onOpen={() => {
                setEditing(u.id)
              }}
            />
          ))}
        </ul>
      </section>
      {manage && <PendingInvites />}
      <section aria-labelledby="family-roles" className="grid gap-2">
        <h2 id="family-roles" className="text-[17px] font-semibold">
          {t('members.rolesTitle')}
        </h2>
        <dl className="grid gap-2 text-sm">
          {ROLES.map((r) => (
            <div key={r} className="flex gap-2">
              <dt className="w-16 shrink-0 font-semibold">{t(`roles.${r}`)}</dt>
              <dd className="text-muted-foreground">{t(`roles.${r}Desc`)}</dd>
            </div>
          ))}
        </dl>
      </section>
      {inviting && (
        <InviteSheet
          onClose={() => {
            setInviting(false)
          }}
        />
      )}
      {editUser && (
        <MemberSheet
          user={editUser}
          onClose={() => {
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}
