import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api, call } from '@/api/client'
import { ApiError } from '@/api/errors'
import type { Baby, Milestone } from '@/api/types'
import { Field, FormError } from '@/components/Field'
import { Button } from '@/components/ui/button'
import { isCalendarDate } from '@/lib/dates'
import { useToday } from '@/settings/useSettings'
import {
  PhotoField,
  assetIds,
  assetItem,
  keepServerOnly,
  queueFiles,
  sameList,
  stripFiles,
} from '@/stories/PhotoField'
import type { StripItem } from '@/stories/PhotoStrip'
import { AdaptiveSheet } from '@/upload/AdaptiveSheet'
import { milestoneLabel } from './labels'
import { findPreset, rangeText } from './presets'
import { milestoneKey, milestoneQuery, milestonesKey } from './useMilestones'

// 서버와 같은 기준. 앞뒤 공백 제거 후 유니코드 문자 수.
const LABEL_MAX = 30
const NOTE_MAX = 100

function charCount(s: string): number {
  return Array.from(s).length
}

interface FieldErrors {
  label?: string
  date?: string
  note?: string
}

// 마일스톤 쓰기(preset 또는 직접 입력), 고치기(milestone). 미리 정한 항목은 바꿀 수 없음.
export function MilestoneSheet({
  baby,
  preset,
  milestone,
  onClose,
}: {
  baby: Baby
  preset?: string
  milestone?: Milestone
  onClose: () => void
}) {
  const { t } = useTranslation()
  const title = milestone
    ? t('milestones.editTitle')
    : preset
      ? milestoneLabel(t, { preset_key: preset, custom_label: null })
      : t('milestones.customTitle')
  return (
    <AdaptiveSheet title={title} onClose={onClose}>
      <MilestoneForm
        baby={baby}
        presetKey={milestone ? milestone.preset_key : (preset ?? null)}
        milestone={milestone}
        onDone={onClose}
      />
    </AdaptiveSheet>
  )
}

function MilestoneForm({
  baby,
  presetKey,
  milestone,
  onDone,
}: {
  baby: Baby
  presetKey: string | null
  milestone: Milestone | undefined
  onDone: () => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const today = useToday()
  // 비교 기준은 시트를 연 때 값으로 고정. 상세 재조회로 서버 쪽 사진이 바뀌어도 사용자 변경으로 보지 않음.
  const [base] = useState(() => {
    const items = (milestone?.assets ?? []).map(assetItem)
    return {
      label: milestone?.custom_label ?? '',
      date: milestone?.achieved_on ?? today,
      note: milestone?.note ?? null,
      items,
      ids: assetIds(items),
    }
  })
  const [label, setLabel] = useState(base.label)
  const [date, setDate] = useState(base.date)
  const [note, setNote] = useState(base.note ?? '')
  const [items, setItems] = useState<StripItem[]>(base.items)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const validDate = isCalendarDate(date)
  const range = rangeText(t, findPreset(presetKey)?.range)

  function check(trimmedLabel: string, trimmedNote: string): boolean {
    const next: FieldErrors = {}
    if (presetKey === null) {
      const n = charCount(trimmedLabel)
      if (n < 1 || n > LABEL_MAX)
        next.label = t('milestones.errors.labelInvalid')
    }
    if (!validDate || date < baby.birth_date || date > today) {
      next.date = t('milestones.errors.dateRange')
    }
    if (charCount(trimmedNote) > NOTE_MAX) {
      next.note = t('milestones.errors.noteTooLong')
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function create(v: {
    label: string
    note: string | null
    ids: string[]
  }): Promise<string> {
    const created = await call(
      api.POST('/api/babies/{id}/milestones', {
        params: { path: { id: baby.id } },
        body: {
          ...(presetKey
            ? { preset_key: presetKey }
            : { custom_label: v.label }),
          achieved_on: date,
          note: v.note,
          asset_ids: v.ids,
        },
      }),
    )
    qc.setQueryData(milestoneKey(created.id), created)
    return created.id
  }

  // 바꾼 필드만. 사진을 바꿨으면 저장 직전 상세를 다시 받아 서버에만 있는 연결 보존.
  async function update(
    m: Milestone,
    v: { label: string; note: string | null; ids: string[] },
  ): Promise<void> {
    const patch: {
      custom_label?: string
      achieved_on?: string
      note?: string | null
      asset_ids?: string[]
    } = {}
    if (presetKey === null && v.label !== base.label)
      patch.custom_label = v.label
    if (date !== base.date) patch.achieved_on = date
    if (v.note !== base.note) patch.note = v.note
    if (!sameList(v.ids, base.ids)) {
      const fresh = await qc.query({ ...milestoneQuery(m.id), staleTime: 0 })
      patch.asset_ids = keepServerOnly(v.ids, base.ids, fresh.assets)
    }
    if (Object.keys(patch).length === 0) return
    const updated = await call(
      api.PATCH('/api/milestones/{id}', {
        params: { path: { id: m.id } },
        body: patch,
      }),
    )
    qc.setQueryData(milestoneKey(m.id), updated)
  }

  async function submit() {
    if (saving) return
    const trimmedLabel = label.trim()
    const trimmedNote = note.trim()
    if (!check(trimmedLabel, trimmedNote)) return
    const v = {
      label: trimmedLabel,
      note: trimmedNote === '' ? null : trimmedNote,
      ids: assetIds(items),
    }
    setSaving(true)
    setError(null)
    try {
      let id: string
      if (milestone) {
        await update(milestone, v)
        id = milestone.id
      } else {
        id = await create(v)
      }
      void qc.invalidateQueries({ queryKey: milestonesKey(baby.id) })
      void qc.invalidateQueries({ queryKey: ['days'] })
      // 저장 뒤 새 파일은 기존 업로드 큐로. 끝나는 대로 서버가 이 마일스톤에 연결.
      const files = stripFiles(items)
      if (files.length > 0) {
        const queued = await queueFiles(qc, files, [baby.id], {
          kind: 'milestone',
          id,
        })
        if (!queued) toast.error(t('milestones.uploadFailed'))
      }
      if (!milestone) toast(t('milestones.saved'))
      onDone()
    } catch (e) {
      // 그사이 다른 보호자가 같은 항목을 기록. 고르기 시트 흐림과 타임라인 갱신.
      if (e instanceof ApiError && e.key === 'milestone.duplicate') {
        void qc.invalidateQueries({ queryKey: milestonesKey(baby.id) })
      }
      setError(e)
      setSaving(false)
    }
  }

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      {presetKey && (milestone || range) && (
        <div className="grid gap-0.5">
          {milestone && (
            <p className="text-[15px] font-semibold">
              {milestoneLabel(t, milestone)}
            </p>
          )}
          {range && <p className="text-sm text-muted-foreground">{range}</p>}
        </div>
      )}
      {presetKey === null && (
        <Field
          label={t('milestones.name')}
          placeholder={t('milestones.namePlaceholder')}
          autoComplete="off"
          value={label}
          error={errors.label}
          onChange={(e) => {
            setLabel(e.target.value)
          }}
        />
      )}
      <Field
        label={t('milestones.date')}
        type="date"
        value={date}
        min={baby.birth_date}
        max={today}
        error={errors.date}
        onChange={(e) => {
          setDate(e.target.value)
        }}
      />
      <Field
        label={t('milestones.note')}
        autoComplete="off"
        value={note}
        error={errors.note}
        onChange={(e) => {
          setNote(e.target.value)
        }}
      />
      <PhotoField
        items={items}
        onChange={setItems}
        date={validDate ? date : undefined}
        hint={t('milestones.uploadHint')}
      />
      <FormError error={error} />
      <Button type="submit" className="h-11" disabled={saving}>
        {t('common.save')}
      </Button>
    </form>
  )
}
