import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api, call } from '@/api/client'
import { FormError } from '@/components/Field'
import { Button } from '@/components/ui/button'
import { formatInZone } from '@/viewer/zoned'
import { useSettings } from './useSettings'

export const sessionsKey = ['sessions'] as const

export function SessionsSection() {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const settings = useSettings()
  const sessions = useQuery({
    queryKey: sessionsKey,
    queryFn: () => call(api.GET('/api/auth/sessions')),
  })
  const revoke = useMutation({
    mutationFn: (id: string) =>
      call(api.DELETE('/api/auth/sessions/{id}', { params: { path: { id } } })),
    onSuccess: () => {
      toast(t('settings.sessionRevoked'))
    },
    onSettled: () => qc.invalidateQueries({ queryKey: sessionsKey }),
  })

  return (
    <div className="grid gap-2">
      <FormError error={sessions.error ?? revoke.error} />
      <ul className="grid gap-2">
        {sessions.data?.sessions.map((s) => {
          const device = s.user_agent ?? t('settings.unknownDevice')
          return (
            <li
              key={s.id}
              className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{device}</p>
                {settings && (
                  <p className="text-sm text-muted-foreground">
                    {t('settings.lastSeen', {
                      time: formatInZone(
                        s.last_seen_at,
                        settings.timezone,
                        i18n.language,
                      ),
                    })}
                  </p>
                )}
              </div>
              {s.current ? (
                <span className="text-sm font-semibold text-primary">
                  {t('settings.currentSession')}
                </span>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={t('settings.revokeSession', { device })}
                  disabled={revoke.isPending}
                  onClick={() => {
                    revoke.mutate(s.id)
                  }}
                >
                  {t('nav.logout')}
                </Button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
