// 확인 시트 집계·미리보기, 선택·놓기 걸러내기, 업로더 형식 보정 공용.
export type MediaKind = 'photo' | 'video'

// MIME 을 비워 보내는 경우(끌어다 놓기, 일부 OS) 대비. Uppy 기본 표에 없는 확장자 포함.
const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  avif: 'image/avif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  webm: 'video/webm',
  '3gp': 'video/3gpp',
}

export function extension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

// 브라우저 MIME 우선. 없거나 형식 미상(octet-stream, HEIC 미지원 OS)이면 확장자, 모르면 빈 문자열.
export function fileMime(file: File): string {
  if (file.type && file.type !== 'application/octet-stream') return file.type
  return EXT_MIME[extension(file.name)] ?? ''
}

export function isHeif(file: File): boolean {
  const mime = fileMime(file)
  return mime === 'image/heic' || mime === 'image/heif'
}

// ACCEPTED_FILE_TYPES 와 같은 기준. 그 밖은 null.
export function mediaKind(file: File): MediaKind | null {
  const mime = fileMime(file)
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('image/')) return 'photo'
  return null
}
