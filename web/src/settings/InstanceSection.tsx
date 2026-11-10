import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api, call } from '@/api/client'
import type { Settings } from '@/api/types'
import { Field, FormError, formText } from '@/components/Field'
import { SelectField } from '@/components/NativeSelect'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { settingsQueryKey } from './useSettings'

type SettingsPatch = Partial<Settings>

function timeZones(current: string): string[] {
  let zones: string[]
  try {
    zones = Intl.supportedValuesOf('timeZone')
  } catch {
    zones = []
  }
  return zones.includes(current) ? zones : [current, ...zones]
}

export function InstanceSection({ settings }: { settings: Settings }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const save = useMutation({
    mutationFn: (body: SettingsPatch) =>
      call(api.PATCH('/api/settings', { body })),
    onSuccess: async (updated, body) => {
      qc.setQueryData(settingsQueryKey, updated)
      const stale = [qc.invalidateQueries({ queryKey: settingsQueryKey })]
      // 시간대가 바뀌면 서버 local_date 가 달라짐.
      if (body.timezone !== undefined) {
        stale.push(
          qc.invalidateQueries({ queryKey: ['assets'] }),
          qc.invalidateQueries({ queryKey: ['days'] }),
        )
      }
      await Promise.all(stale)
      toast(t('settings.instanceSaved'))
    },
  })

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        const form = new FormData(e.currentTarget)
        const next: Settings = {
          instance_name: formText(form, 'instance_name').trim(),
          timezone: formText(form, 'timezone'),
          default_locale: formText(form, 'default_locale'),
          derivatives_avif: form.get('derivatives_avif') === 'on',
          trash_retention_days: Number(formText(form, 'trash_retention_days')),
        }
        const body: SettingsPatch = {}
        if (next.instance_name !== settings.instance_name) {
          body.instance_name = next.instance_name
        }
        if (next.timezone !== settings.timezone) body.timezone = next.timezone
        if (next.default_locale !== settings.default_locale) {
          body.default_locale = next.default_locale
        }
        if (next.derivatives_avif !== settings.derivatives_avif) {
          body.derivatives_avif = next.derivatives_avif
        }
        if (next.trash_retention_days !== settings.trash_retention_days) {
          body.trash_retention_days = next.trash_retention_days
        }
        if (Object.keys(body).length > 0) save.mutate(body)
      }}
    >
      <Field
        label={t('settings.instanceName')}
        name="instance_name"
        defaultValue={settings.instance_name}
        required
        maxLength={64}
      />
      <SelectField
        label={t('settings.timezone')}
        hint={t('settings.timezoneHint')}
        name="timezone"
        defaultValue={settings.timezone}
      >
        {timeZones(settings.timezone).map((z) => (
          <option key={z} value={z}>
            {z}
          </option>
        ))}
      </SelectField>
      <SelectField
        label={t('settings.defaultLocale')}
        name="default_locale"
        defaultValue={settings.default_locale}
      >
        <option value="ko">{t('settings.localeKo')}</option>
        <option value="en">{t('settings.localeEn')}</option>
      </SelectField>
      <div className="grid gap-1">
        <div className="flex items-center gap-2">
          <input
            id="derivatives-avif"
            name="derivatives_avif"
            type="checkbox"
            className="size-4 accent-primary"
            defaultChecked={settings.derivatives_avif}
          />
          <Label htmlFor="derivatives-avif">{t('settings.avif')}</Label>
        </div>
        <p className="text-xs text-muted-foreground">
          {t('settings.avifHint')}
        </p>
      </div>
      <Field
        label={t('settings.trashRetention')}
        hint={t('settings.trashRetentionHint')}
        name="trash_retention_days"
        type="number"
        inputMode="numeric"
        min={0}
        max={3650}
        step={1}
        defaultValue={settings.trash_retention_days}
        required
      />
      <FormError error={save.error} />
      <div>
        <Button type="submit" disabled={save.isPending}>
          {t('common.save')}
        </Button>
      </div>
    </form>
  )
}
