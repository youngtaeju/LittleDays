import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, call } from '@/api/client'
import type { Baby } from '@/api/types'
import { Field, FormError, formText } from '@/components/Field'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { babiesKey } from '@/timeline/useBabies'

type Sex = NonNullable<Baby['sex']>

function parseSex(v: string): Sex | null {
  return v === 'female' || v === 'male' ? v : null
}

// baby 없으면 추가, 있으면 전체 교체 수정.
export function BabyForm({
  baby,
  onDone,
}: {
  baby?: Baby
  onDone: () => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const sexId = useId()
  const [clearAvatar, setClearAvatar] = useState(false)
  const save = useMutation({
    mutationFn: (f: FormData) => {
      const name = formText(f, 'name')
      const birth_date = formText(f, 'birth_date')
      const sex = parseSex(formText(f, 'sex'))
      if (!baby) {
        return call(
          api.POST('/api/babies', {
            body: { name, birth_date, ...(sex && { sex }) },
          }),
        )
      }
      return call(
        api.PUT('/api/babies/{id}', {
          params: { path: { id: baby.id } },
          body: {
            name,
            birth_date,
            sex,
            avatar_asset_id: clearAvatar ? null : baby.avatar_asset_id,
          },
        }),
      )
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: babiesKey })
      onDone()
    },
  })

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate(new FormData(e.currentTarget))
      }}
    >
      <Field
        label={t('babies.name')}
        name="name"
        defaultValue={baby?.name}
        required
      />
      <Field
        label={t('babies.birthDate')}
        name="birth_date"
        type="date"
        defaultValue={baby?.birth_date}
        required
      />
      <div className="grid gap-2">
        <Label htmlFor={sexId}>{t('babies.sex')}</Label>
        <select
          id={sexId}
          name="sex"
          defaultValue={baby?.sex ?? ''}
          className="h-9 rounded-md border border-border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <option value="">{t('babies.sexUnset')}</option>
          <option value="female">{t('babies.sexFemale')}</option>
          <option value="male">{t('babies.sexMale')}</option>
        </select>
      </div>
      {baby?.avatar_asset_id && (
        <div className="flex items-center gap-2">
          <Checkbox
            id="clear-avatar"
            checked={clearAvatar}
            onCheckedChange={(v) => {
              setClearAvatar(v === true)
            }}
          />
          <Label htmlFor="clear-avatar">{t('babies.clearAvatar')}</Label>
        </div>
      )}
      <FormError error={save.error} />
      <Button type="submit" disabled={save.isPending}>
        {t('common.save')}
      </Button>
    </form>
  )
}
