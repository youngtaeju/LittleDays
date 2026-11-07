import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, call } from '@/api/client'
import type { Asset } from '@/api/types'
import { FormError } from '@/components/Field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { applyAsset } from './useAsset'
import { fromZonedInput, toZonedInput } from './zoned'

// 인스턴스 시간대 기준 입력. 저장 시 UTC 로 변환, 출처는 서버가 manual 로.
export function TakenAtEditor({
  asset,
  tz,
  onDone,
}: {
  asset: Asset
  tz: string
  onDone: () => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const hintId = useId()
  const [initial] = useState(() => toZonedInput(asset.taken_at, tz))
  const [value, setValue] = useState(initial)
  const save = useMutation({
    mutationFn: (local: string) =>
      call(
        api.PATCH('/api/assets/{id}', {
          params: { path: { id: asset.id } },
          body: { taken_at: fromZonedInput(local, tz) },
        }),
      ),
    onSuccess: (a) => {
      applyAsset(qc, a)
      onDone()
    },
  })

  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate(value)
      }}
    >
      <Input
        type="datetime-local"
        aria-label={t('viewer.takenAt')}
        aria-describedby={hintId}
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
        }}
        required
        autoFocus
      />
      <p id={hintId} className="text-xs text-muted-foreground">
        {t('viewer.timezone')}: {tz}
      </p>
      <FormError error={save.error} />
      <div className="flex gap-2">
        <Button
          type="submit"
          disabled={!value || value === initial || save.isPending}
        >
          {t('common.save')}
        </Button>
        <Button type="button" variant="outline" onClick={onDone}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  )
}
