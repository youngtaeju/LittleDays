import { describe, expect, it } from 'vitest'
import { neighbors, outsideTimeline } from './neighbors'

describe('neighbors', () => {
  it('middle_has_both', () => {
    expect(neighbors(['a', 'b', 'c'], 'b')).toEqual({ prev: 'a', next: 'c' })
  })

  it('first_has_no_prev', () => {
    expect(neighbors(['a', 'b', 'c'], 'a')).toEqual({ next: 'b' })
  })

  it('missing_id_has_none', () => {
    expect(neighbors(['a', 'b', 'c'], 'x')).toEqual({})
  })
})

describe('outsideTimeline', () => {
  const last = { taken_at: '2024-05-10T03:00:00Z' }
  const detail = {
    deleted_at: null,
    taken_at: '2024-05-01T00:00:00Z',
    baby_ids: ['b1'],
    kind: 'photo' as const,
  }

  it('older_asset_may_be_on_next_page', () => {
    expect(outsideTimeline(detail, last, undefined)).toBe(false)
    expect(outsideTimeline(detail, last, 'b1')).toBe(false)
  })

  it('same_time_keeps_paging', () => {
    expect(
      outsideTimeline({ ...detail, taken_at: last.taken_at }, last, undefined),
    ).toBe(false)
  })

  it('trashed_newer_or_other_baby_is_outside', () => {
    expect(
      outsideTimeline(
        { ...detail, deleted_at: '2024-06-01T00:00:00Z' },
        last,
        undefined,
      ),
    ).toBe(true)
    expect(
      outsideTimeline(
        { ...detail, taken_at: '2024-05-11T00:00:00Z' },
        last,
        undefined,
      ),
    ).toBe(true)
    expect(outsideTimeline(detail, last, 'b2')).toBe(true)
  })

  it('outside_video_list', () => {
    expect(outsideTimeline(detail, last, undefined, 'video')).toBe(true)
    expect(
      outsideTimeline({ ...detail, kind: 'video' }, last, undefined, 'video'),
    ).toBe(false)
    expect(outsideTimeline(detail, last, undefined)).toBe(false)
  })
})
