import { describe, expect, it } from 'vitest'
import { fileMime, mediaKind } from './fileKind'

function file(name: string, type = '') {
  return new File(['x'], name, { type })
}

describe('fileKind', () => {
  it('empty_mime_by_extension', () => {
    for (const n of [
      'a.JPG',
      'a.jpeg',
      'a.png',
      'a.webp',
      'a.gif',
      'a.heic',
      'a.heif',
      'a.avif',
    ]) {
      expect(mediaKind(file(n))).toBe('photo')
    }
    for (const n of ['a.mp4', 'a.MOV', 'a.m4v', 'a.webm', 'a.3gp']) {
      expect(mediaKind(file(n))).toBe('video')
    }
    expect(mediaKind(file('a.pdf'))).toBeNull()
    expect(mediaKind(file('noext'))).toBeNull()
    // MIME 있으면 그대로.
    expect(mediaKind(file('a.bin', 'video/mp4'))).toBe('video')
    expect(fileMime(file('a.3gp'))).toBe('video/3gpp')
    expect(fileMime(file('a.jpg', 'image/png'))).toBe('image/png')
  })
})
