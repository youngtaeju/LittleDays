import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, call } from '@/api/client'
import type { Baby, GrowthRecord } from '@/api/types'
import { BabyRadioGroup } from '@/babies/BabyRadioGroup'
import { pickBaby } from '@/babies/lastBaby'
import { Field, FormError } from '@/components/Field'
import { Button } from '@/components/ui/button'
import { isCalendarDate } from '@/lib/dates'
import { useToday } from '@/settings/useSettings'
import { useBabies } from '@/timeline/useBabies'
import { AdaptiveSheet } from '@/upload/AdaptiveSheet'
import { growthKey, isBorn } from './useGrowth'

// 서버와 같은 기준. 메모는 앞뒤 공백 제거 후 유니코드 문자 수.
const NOTE_MAX = 100

// 빈칸 null, 숫자 형식 아니면 NaN. 쉼표 소수점 허용(일부 키패드).
function parseDecimal(s: string): number | null {
  const v = s.trim().replace(',', '.')
  if (v === '') return null
  return /^\d+(\.\d+)?$/.test(v) ? Number(v) : NaN
}

// 자릿수 검사는 반올림 비교(부동소수 나머지 오차 회피).
function validHeight(x: number): boolean {
  return x >= 20 && x <= 150 && Math.round(x * 10) / 10 === x
}

function validWeight(x: number): boolean {
  return x >= 0.5 && x <= 50 && Math.round(x * 100) / 100 === x
}

function decimalText(v: number | null | undefined): string {
  return v == null ? '' : String(v)
}

// 키와 몸무게 쓰기, 고치기(record), 지우기. babyId 도 record 도 없으면 아기 고르기(태어난 아기 둘 이상일 때).
export function GrowthSheet({
  babyId,
  record,
  onClose,
}: {
  babyId?: string
  record?: GrowthRecord
  onClose: () => void
}) {
  const { t } = useTranslation()
  const today = useToday()
  const babies = useBabies()
  const fixedId = record?.baby_id ?? babyId
  const born = (babies.data ?? []).filter((b) => isBorn(b, today))
  const fixed = fixedId ? babies.data?.find((b) => b.id === fixedId) : undefined

  let body
  if (babies.isPending) {
    body = (
      <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
    )
  } else if (babies.isError) {
    body = <FormError error={babies.error} />
  } else if (fixedId && !fixed) {
    body = <p className="text-sm">{t('errors.babies.notFound')}</p>
  } else if (!fixed && born.length === 0) {
    body = <p className="text-sm">{t('growth.noBabies')}</p>
  } else {
    body = (
      <GrowthForm
        fixed={fixed}
        babies={born}
        record={record}
        today={today}
        onDone={onClose}
      />
    )
  }
  return (
    <AdaptiveSheet
      title={record ? t('growth.editTitle') : t('growth.newTitle')}
      onClose={onClose}
    >
      {body}
    </AdaptiveSheet>
  )
}

interface FieldErrors {
  date?: string
  height?: string
  weight?: string
  note?: string
  value?: string
}

function GrowthForm({
  fixed,
  babies,
  record,
  today,
  onDone,
}: {
  fixed?: Baby
  babies: Baby[]
  record?: GrowthRecord
  today: string
  onDone: () => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [selectedId, setSelectedId] = useState(
    () => fixed?.id ?? pickBaby(babies)?.id ?? '',
  )
  const baby = fixed ?? babies.find((b) => b.id === selectedId)
  const [date, setDate] = useState(record?.measured_on ?? today)
  const [height, setHeight] = useState(decimalText(record?.height_cm))
  const [weight, setWeight] = useState(decimalText(record?.weight_kg))
  const [note, setNote] = useState(record?.note ?? '')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [confirming, setConfirming] = useState(false)

  const done = async (id: string) => {
    await qc.invalidateQueries({ queryKey: growthKey(id) })
    onDone()
  }

  const save = useMutation({
    mutationFn: (v: {
      babyId: string
      body: {
        measured_on: string
        height_cm: number | null
        weight_kg: number | null
        note: string | null
      }
    }) =>
      record
        ? call(
            api.PATCH('/api/growth/{id}', {
              params: { path: { id: record.id } },
              body: v.body,
            }),
          )
        : call(
            api.POST('/api/babies/{id}/growth', {
              params: { path: { id: v.babyId } },
              body: v.body,
            }),
          ),
    onSuccess: (_saved, v) => done(v.babyId),
  })

  const remove = useMutation({
    mutationFn: (r: GrowthRecord) =>
      call(api.DELETE('/api/growth/{id}', { params: { path: { id: r.id } } })),
    onSuccess: (_r, r) => done(r.baby_id),
  })

  function submit() {
    if (!baby) return
    const h = parseDecimal(height)
    const w = parseDecimal(weight)
    const trimmed = note.trim()
    const next: FieldErrors = {}
    if (!isCalendarDate(date) || date < baby.birth_date || date > today) {
      next.date = t('growth.errors.dateRange')
    }
    if (h !== null && !validHeight(h))
      next.height = t('growth.errors.heightInvalid')
    if (w !== null && !validWeight(w))
      next.weight = t('growth.errors.weightInvalid')
    if (h === null && w === null) next.value = t('growth.errors.valueRequired')
    if (Array.from(trimmed).length > NOTE_MAX) {
      next.note = t('growth.errors.noteTooLong')
    }
    setErrors(next)
    if (Object.keys(next).length > 0) return
    save.mutate({
      babyId: baby.id,
      body: {
        measured_on: date,
        height_cm: h,
        weight_kg: w,
        note: trimmed === '' ? null : trimmed,
      },
    })
  }

  if (record && confirming) {
    return (
      <div className="grid gap-4">
        <p className="text-sm">{t('growth.deleteConfirm')}</p>
        <FormError error={remove.error} />
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            onClick={() => {
              remove.reset()
              setConfirming(false)
            }}
          >
            {t('common.cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => {
              remove.mutate(record)
            }}
          >
            {t('growth.deleteSubmit')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      {!fixed && babies.length > 1 && (
        <BabyRadioGroup
          label={t('growth.baby')}
          babies={babies}
          selected={selectedId}
          onSelect={setSelectedId}
        />
      )}
      <Field
        label={t('growth.date')}
        type="date"
        value={date}
        min={baby?.birth_date}
        max={today}
        error={errors.date}
        onChange={(e) => {
          setDate(e.target.value)
        }}
      />
      <div className="grid grid-cols-2 gap-3">
        <Field
          label={t('growth.heightField')}
          inputMode="decimal"
          autoComplete="off"
          value={height}
          error={errors.height}
          onChange={(e) => {
            setHeight(e.target.value)
          }}
        />
        <Field
          label={t('growth.weightField')}
          inputMode="decimal"
          autoComplete="off"
          value={weight}
          error={errors.weight}
          onChange={(e) => {
            setWeight(e.target.value)
          }}
        />
      </div>
      {errors.value && (
        <p role="alert" className="text-sm text-destructive">
          {errors.value}
        </p>
      )}
      <Field
        label={t('growth.note')}
        value={note}
        error={errors.note}
        onChange={(e) => {
          setNote(e.target.value)
        }}
      />
      <FormError error={save.error} />
      <Button type="submit" disabled={save.isPending || !baby}>
        {t('common.save')}
      </Button>
      {record && (
        <Button
          type="button"
          variant="ghost"
          className="text-destructive"
          onClick={() => {
            setConfirming(true)
          }}
        >
          {t('growth.delete')}
        </Button>
      )}
    </form>
  )
}
