import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadLastBabies, saveLastBabies } from './lastBabies'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('lastBabies', () => {
  it('roundtrip_filters_missing', () => {
    saveLastBabies(['b1', 'b2'])
    expect(localStorage.getItem('ld.upload.babies')).toBe('["b1","b2"]')
    // 지운 아기(b2)는 제외.
    expect(loadLastBabies(['b1', 'b3'])).toEqual(['b1'])
  })

  it('ignores_bad_value', () => {
    expect(loadLastBabies(['b1'])).toEqual([])
    localStorage.setItem('ld.upload.babies', '{')
    expect(loadLastBabies(['b1'])).toEqual([])
    localStorage.setItem('ld.upload.babies', '[1,"b1"]')
    expect(loadLastBabies(['b1'])).toEqual(['b1'])
  })

  it('storage_errors_ignored', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => {
      saveLastBabies(['b1'])
    }).not.toThrow()
    expect(loadLastBabies(['b1'])).toEqual([])
  })
})
