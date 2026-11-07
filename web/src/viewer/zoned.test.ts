import { afterEach, describe, expect, it } from 'vitest'
import {
  formatInZone,
  fromZonedInput,
  todayInZone,
  toZonedInput,
} from './zoned'

const originalTz = process.env.TZ

afterEach(() => {
  // undefined 대입은 문자열 "undefined" 로 저장.
  if (originalTz === undefined) delete process.env.TZ
  else process.env.TZ = originalTz
})

describe('zoned', () => {
  it('round_trip_seoul', () => {
    expect(fromZonedInput('2024-05-01T10:20', 'Asia/Seoul')).toBe(
      '2024-05-01T01:20:00.000Z',
    )
    expect(toZonedInput('2024-05-01T01:20:00.000Z', 'Asia/Seoul')).toBe(
      '2024-05-01T10:20',
    )
  })

  it('dst_new_york', () => {
    expect(fromZonedInput('2024-07-01T12:00', 'America/New_York')).toBe(
      '2024-07-01T16:00:00.000Z',
    )
    expect(fromZonedInput('2024-01-15T12:00', 'America/New_York')).toBe(
      '2024-01-15T17:00:00.000Z',
    )
    expect(toZonedInput('2024-07-01T16:00:00Z', 'America/New_York')).toBe(
      '2024-07-01T12:00',
    )
  })

  it('browser_tz_irrelevant', () => {
    process.env.TZ = 'Europe/Berlin'
    expect(fromZonedInput('2024-05-01T10:20', 'Asia/Seoul')).toBe(
      '2024-05-01T01:20:00.000Z',
    )
    expect(fromZonedInput('2024-07-01T12:00', 'America/New_York')).toBe(
      '2024-07-01T16:00:00.000Z',
    )
    expect(fromZonedInput('2024-01-15T12:00', 'America/New_York')).toBe(
      '2024-01-15T17:00:00.000Z',
    )
    expect(toZonedInput('2024-05-01T01:20:00.000Z', 'Asia/Seoul')).toBe(
      '2024-05-01T10:20',
    )
  })

  it('today_in_zone', () => {
    const now = new Date('2024-05-01T16:00:00Z')
    expect(todayInZone('Asia/Seoul', now)).toBe('2024-05-02')
    expect(todayInZone('UTC', now)).toBe('2024-05-01')
  })

  it('midnight_is_00', () => {
    expect(toZonedInput('2024-05-01T15:05:00Z', 'Asia/Seoul')).toBe(
      '2024-05-02T00:05',
    )
  })

  it('format_uses_zone', () => {
    const text = formatInZone('2024-05-01T16:30:00Z', 'Asia/Seoul', 'ko')
    expect(text).toContain('2024년 5월 2일')
    expect(text).toContain('1:30')
  })
})
