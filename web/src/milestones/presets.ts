import type { TFunction } from 'i18next'

export type MilestoneGroup = 'motion' | 'social' | 'life'

// who: WHO Motor Development Study 1~99 백분위(개월 반올림).
// cdc: CDC/AAP 2022 이정표(75% 이상이 그 나이까지).
export type MilestoneRange =
  { from: number; to: number; source: 'who' } | { by: number; source: 'cdc' }

export interface MilestonePreset {
  key: string
  group: MilestoneGroup
  range: MilestoneRange | null
}

export const MILESTONE_GROUPS: readonly MilestoneGroup[] = [
  'motion',
  'social',
  'life',
]

// 스펙 §8 표 순서. 키는 서버 상수와 같음.
export const MILESTONE_PRESETS: readonly MilestonePreset[] = [
  { key: 'first_smile', group: 'social', range: { by: 2, source: 'cdc' } },
  { key: 'neck_control', group: 'motion', range: { by: 4, source: 'cdc' } },
  { key: 'rollover', group: 'motion', range: { by: 6, source: 'cdc' } },
  {
    key: 'sit_alone',
    group: 'motion',
    range: { from: 4, to: 9, source: 'who' },
  },
  { key: 'crawl', group: 'motion', range: { from: 5, to: 14, source: 'who' } },
  {
    key: 'stand_holding',
    group: 'motion',
    range: { from: 5, to: 11, source: 'who' },
  },
  {
    key: 'walk_holding',
    group: 'motion',
    range: { from: 6, to: 14, source: 'who' },
  },
  {
    key: 'stand_alone',
    group: 'motion',
    range: { from: 7, to: 17, source: 'who' },
  },
  {
    key: 'walk_alone',
    group: 'motion',
    range: { from: 8, to: 18, source: 'who' },
  },
  { key: 'run', group: 'motion', range: { by: 24, source: 'cdc' } },
  { key: 'stairs', group: 'motion', range: { by: 24, source: 'cdc' } },
  { key: 'first_word', group: 'social', range: { by: 12, source: 'cdc' } },
  { key: 'two_words', group: 'social', range: { by: 24, source: 'cdc' } },
  { key: 'wave_bye', group: 'social', range: { by: 12, source: 'cdc' } },
  { key: 'clap', group: 'social', range: { by: 15, source: 'cdc' } },
  { key: 'point', group: 'social', range: { by: 15, source: 'cdc' } },
  { key: 'spoon_self', group: 'life', range: { by: 18, source: 'cdc' } },
  { key: 'first_tooth', group: 'life', range: null },
  { key: 'first_solid_food', group: 'life', range: null },
  { key: 'sleep_through', group: 'life', range: null },
  { key: 'potty', group: 'life', range: null },
  { key: 'first_haircut', group: 'life', range: null },
  { key: 'first_trip', group: 'life', range: null },
  { key: 'first_daycare', group: 'life', range: null },
]

export function findPreset(key: string | null): MilestonePreset | undefined {
  return key ? MILESTONE_PRESETS.find((p) => p.key === key) : undefined
}

// "보통 N~M개월"(who), "대부분 N개월까지"(cdc). 범위 없으면 null.
export function rangeText(
  t: TFunction,
  range: MilestoneRange | null | undefined,
): string | null {
  if (!range) return null
  return range.source === 'who'
    ? t('milestones.rangeWho', { from: range.from, to: range.to })
    : t('milestones.rangeCdc', { by: range.by })
}
