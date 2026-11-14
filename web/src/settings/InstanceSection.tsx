import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api, call } from '@/api/client'
import type { Settings } from '@/api/types'
import { Field, FormError, formText } from '@/components/Field'
import { SelectField } from '@/components/NativeSelect'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { primaryBaby } from '@/babies/usePrimaryBaby'
import { useBabies } from '@/timeline/useBabies'
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
  const babies = useBabies().data
  // 고르기는 2명 이상일 때만. 설정 없음, 지워진 아기면 첫째가 선택된 상태.
  const picker = babies && babies.length >= 2 ? babies : undefined
  const shownPrimary =
    picker && primaryBaby(picker, settings.primary_baby_id)?.id
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
          primary_baby_id: picker
            ? formText(form, 'primary_baby_id')
            : settings.primary_baby_id,
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
        // 보이는 선택과 비교. 그대로 두면 보내지 않음.
        if (picker && next.primary_baby_id !== shownPrimary) {
          body.primary_baby_id = next.primary_baby_id
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
      {picker && (
        <SelectField
          label={t('settings.primaryBaby')}
          hint={t('settings.primaryBabyHint')}
          name="primary_baby_id"
          defaultValue={shownPrimary}
        >
          {picker.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </SelectField>
      )}
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
