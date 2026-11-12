import type { TFunction } from 'i18next'
import type { MilestoneSummary } from '@/api/types'

// 미리 정한 항목은 번역 이름, 직접 입력은 사용자가 쓴 이름. 모르는 key 는 key 그대로.
export function milestoneLabel(
  t: TFunction,
  m: Pick<MilestoneSummary, 'preset_key' | 'custom_label'>,
): string {
  if (m.preset_key) {
    return t(`milestones.presets.${m.preset_key}`, {
      defaultValue: m.preset_key,
    })
  }
  return m.custom_label ?? ''
}
