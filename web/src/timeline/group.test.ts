import { afterEach, describe, expect, it } from 'vitest'
import type { AssetSummary } from '@/api/types'
import { assetSummaryFixture } from '@/test/fixtures'
import { groupByLocalDate } from './group'

function item(id: string, local_date: string, taken_at: string): AssetSummary {
  return { ...assetSummaryFixture(id), local_date, taken_at }
}

const originalTz = process.env.TZ

afterEach(() => {
  process.env.TZ = originalTz
})

describe('groupByLocalDate', () => {
  it('groups_by_server_local_date', () => {
    const items = [item('a', '2024-05-02', '2024-05-01T16:00:00Z')]
    const expected = [
      { month: '2024-05', days: [{ date: '2024-05-02', items }] },
    ]
    expect(groupByLocalDate(items)).toEqual(expected)

    // 브라우저 시간대와 무관.
    process.env.TZ = 'America/Los_Angeles'
    expect(groupByLocalDate(items)).toEqual(expected)
  })

  it('month_and_day_order_kept', () => {
    const items = [
      item('a', '2024-05-02', '2024-05-02T03:00:00Z'),
      item('b', '2024-05-02', '2024-05-02T01:00:00Z'),
      item('c', '2024-05-01', '2024-05-01T01:00:00Z'),
      item('d', '2024-04-30', '2024-04-30T01:00:00Z'),
    ]
    const months = groupByLocalDate(items)
    expect(months.map((m) => m.month)).toEqual(['2024-05', '2024-04'])
    expect(months[0]?.days.map((d) => d.date)).toEqual([
      '2024-05-02',
      '2024-05-01',
    ])
    expect(months[0]?.days[0]?.items.map((i) => i.id)).toEqual(['a', 'b'])
  })
})
