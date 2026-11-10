import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, call } from '@/api/client'
import type { Baby } from '@/api/types'
import { Field, FormError, formText } from '@/components/Field'
import { SelectField } from '@/components/NativeSelect'
import { Button } from '@/components/ui/button'
import { babiesKey } from '@/timeline/useBabies'
import { AvatarPicker, type AvatarValue, type PickStep } from './AvatarPicker'
import { babyStatsPrefix } from './useBabyStats'

type Sex = NonNullable<Baby['sex']>

function parseSex(v: string): Sex | null {
  return v === 'female' || v === 'male' ? v : null
}

// baby 없으면 추가, 있으면 전체 교체 수정.
// 대표 사진은 수정에서만(새 아기는 태그된 사진 없음). 사진을 바꾸면 자르기도 같이 교체(서버는 지울 때만 초기화).
export function BabyForm({
  baby,
  onDone,
}: {
  baby?: Baby
  onDone: (saved: Baby) => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [avatar, setAvatar] = useState<AvatarValue>({
    assetId: baby?.avatar_asset_id ?? null,
    crop: baby?.avatar_crop ?? null,
  })
  const [step, setStep] = useState<PickStep | null>(null)
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
            avatar_asset_id: avatar.assetId,
            avatar_crop: avatar.crop,
          },
        }),
      )
    },
    onSuccess: async (saved) => {
      // 생년월일 변경 시 개월 묶음도 바뀜.
      await Promise.all([
        qc.invalidateQueries({ queryKey: babiesKey }),
        qc.invalidateQueries({ queryKey: babyStatsPrefix }),
      ])
      onDone(saved)
    },
  })

  return (
    <div className="grid gap-4">
      {baby && (
        <AvatarPicker
          baby={baby}
          value={avatar}
          onChange={setAvatar}
          step={step}
          onStepChange={setStep}
        />
      )}
      {/* 사진 고르는 동안 숨김. 언마운트하지 않아 입력값 유지. */}
      <form
        className={step ? 'hidden' : 'grid gap-4'}
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
        <SelectField
          label={t('babies.sex')}
          name="sex"
          defaultValue={baby?.sex ?? ''}
        >
          <option value="">{t('babies.sexUnset')}</option>
          <option value="female">{t('babies.sexFemale')}</option>
          <option value="male">{t('babies.sexMale')}</option>
        </SelectField>
        <FormError error={save.error} />
        <Button type="submit" disabled={save.isPending}>
          {t('babies.save')}
        </Button>
      </form>
    </div>
  )
}
