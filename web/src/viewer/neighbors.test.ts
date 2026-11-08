import { describe, expect, it } from 'vitest'
import { neighbors } from './neighbors'

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
