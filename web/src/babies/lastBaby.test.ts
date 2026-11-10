import { afterEach, describe, expect, it } from 'vitest'
import { loadLastBaby, saveLastBaby } from './lastBaby'

afterEach(() => {
  localStorage.clear()
})

describe('lastBaby', () => {
  it('roundtrip', () => {
    expect(loadLastBaby()).toBeNull()
    saveLastBaby('b1')
    expect(loadLastBaby()).toBe('b1')
    expect(localStorage.getItem('ld.baby.last')).toBe('b1')
  })
})
