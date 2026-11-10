import { afterEach, describe, expect, it } from 'vitest'
import {
  formatInZone,
  formatMoment,
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

  it('format_moment_period_and_year', () => {
    const ko = { am: '오전', pm: '오후' }
    const now = new Date('2026-11-10T00:00:00Z')
    // 같은 해는 연도 생략. tz 기준 시각·오전/오후.
    expect(
      formatMoment('2026-11-09T06:24:00Z', 'Asia/Seoul', 'ko', ko, now),
    ).toBe('11월 9일 오후 3:24')
    expect(
      formatMoment('2026-11-08T23:05:00Z', 'Asia/Seoul', 'ko', ko, now),
    ).toBe('11월 9일 오전 8:05')
    expect(
      formatMoment('2025-12-31T16:00:00Z', 'Asia/Seoul', 'ko', ko, now),
    ).toBe('1월 1일 오전 1:00')
    expect(
      formatMoment('2025-12-31T14:59:00Z', 'Asia/Seoul', 'ko', ko, now),
    ).toBe('2025년 12월 31일 오후 11:59')
    expect(
      formatMoment(
        '2026-11-09T06:24:00Z',
        'Asia/Seoul',
        'en',
        {
          am: 'AM',
          pm: 'PM',
        },
        now,
      ),
    ).toMatch(/^November 9.* 3:24\sPM$/)
  })
})
