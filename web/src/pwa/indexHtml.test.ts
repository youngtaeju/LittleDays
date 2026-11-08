import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('index.html', () => {
  // CSP script-src 'self' 는 인라인 스크립트를 차단.
  it('index_has_no_inline_script', () => {
    const html = fs.readFileSync(
      path.resolve(import.meta.dirname, '../../index.html'),
      'utf8',
    )
    const inline = [...html.matchAll(/<script\b([^>]*)>/gi)].filter(
      (m) => !/\bsrc\s*=/.test(m[1] ?? ''),
    )
    expect(inline).toHaveLength(0)
  })
})
