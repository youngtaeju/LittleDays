import fs from 'node:fs'
import path from 'node:path'
import i18next from 'i18next'
import { beforeAll, describe, expect, it } from 'vitest'
import { ApiError } from '@/api/errors'
import en from '@/locales/en.json'
import ko from '@/locales/ko.json'
import { errorMessage, initI18n, pickLocale } from './index'

function has(obj: unknown, dotted: string): boolean {
  let cur: unknown = obj
  for (const part of dotted.split('.')) {
    if (typeof cur !== 'object' || cur === null || !(part in cur)) return false
    cur = (cur as Record<string, unknown>)[part]
  }
  return typeof cur === 'string'
}

function flatten(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null
      ? flatten(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  )
}

function rsFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name)
    if (d.isDirectory()) return rsFiles(p)
    return p.endsWith('.rs') ? [p] : []
  })
}

describe('i18n', () => {
  beforeAll(() => {
    initI18n('ko')
  })

  it('pick_locale', () => {
    expect(pickLocale('en', 'ko-KR')).toBe('en')
    expect(pickLocale(null, 'ko-KR')).toBe('ko')
    expect(pickLocale(null, 'fr')).toBe('en')
    expect(pickLocale('xx', 'ko')).toBe('ko')
  })

  it('error_message_fallback', () => {
    const t = i18next.t.bind(i18next)
    expect(errorMessage(t, new ApiError(404, 'asset.notFound', {}))).toBe(
      ko.errors.asset.notFound,
    )
    expect(errorMessage(t, new ApiError(500, 'foo.bar', {}))).toBe(
      ko.errors.unknown,
    )
    expect(errorMessage(t, new Error('x'))).toBe(ko.errors.unknown)
  })

  it('every_server_error_key_is_translated', () => {
    const re =
      /"((?:asset|auth|babies|day|invite|request|server|settings|upload|users)\.[a-zA-Z]+)"/g
    const keys = new Set<string>()
    for (const f of rsFiles(
      path.resolve(import.meta.dirname, '../../../server/src'),
    )) {
      for (const m of fs.readFileSync(f, 'utf8').matchAll(re))
        keys.add(m[1] ?? '')
    }
    expect(keys.size).toBeGreaterThan(40)
    for (const [name, loc] of [
      ['ko', ko],
      ['en', en],
    ] as const) {
      const missing = [...keys].filter((k) => !has(loc.errors, k))
      expect(missing, `${name} 누락 키`).toEqual([])
    }
  })

  it('html_lang_follows_language', async () => {
    await i18next.changeLanguage('en')
    expect(document.documentElement.lang).toBe('en')
    await i18next.changeLanguage('ko')
    expect(document.documentElement.lang).toBe('ko')
  })

  it('ko_en_have_same_keys', () => {
    // 복수형 접미사(_one/_other)는 언어별 카테고리가 달라 기본 키로 합쳐 비교.
    const base = (keys: string[]) =>
      [...new Set(keys.map((k) => k.replace(/_(one|other)$/, '')))].sort()
    expect(base(flatten(en))).toEqual(base(flatten(ko)))
  })
})
