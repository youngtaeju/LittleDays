import type { Asset, AssetSummary } from '@/api/types'

// 웹은 쿠키 인증. media token 미사용.
function base(id: string): string {
  return `/api/assets/${id}`
}

export function thumbUrl(id: string): string {
  return `${base(id)}/thumb.webp`
}

// WebP 는 항상 생성(AVIF 만 설정 의존).
export function previewUrl(id: string): string {
  return `${base(id)}/preview.webp`
}

// 파생물에 있는 형식만.
export function previewSources(a: AssetSummary | Asset): {
  avif?: string
  webp?: string
} {
  const formats = a.derivatives.preview?.formats ?? []
  return {
    ...(formats.includes('avif') && { avif: `${base(a.id)}/preview.avif` }),
    ...(formats.includes('webp') && { webp: `${base(a.id)}/preview.webp` }),
  }
}

export function largeUrl(id: string): string {
  return `${base(id)}/large.webp`
}

export function videoUrl(id: string): string {
  return `${base(id)}/video`
}

export function originalUrl(id: string): string {
  return `${base(id)}/original`
}
