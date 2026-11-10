import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { Baby } from '@/api/types'
import { cn } from '@/lib/utils'
import { previewUrl, thumbUrl } from '@/timeline/media'
import { assetQuery } from '@/viewer/useAsset'
import { cropStyle } from './crop'

// 이하 thumb(긴 변 400), 초과 preview(긴 변 1600).
const THUMB_MAX_PX = 64

// 이름 첫 글자 크기. 글자 크기 단계 안에서.
function initialClass(size: number): string {
  if (size >= 64) return 'text-xl'
  if (size >= 40) return 'text-base'
  return 'text-xs'
}

// 장식용(옆에 이름 표시). 대표 사진 없음·로드 실패 → 강조 옅은 면 원 + 첫 글자.
export function Avatar({
  baby,
  size,
  className,
}: {
  baby: Baby
  size: number
  className?: string
}) {
  const id = baby.avatar_asset_id
  const crop = baby.avatar_crop
  const src = id && (size <= THUMB_MAX_PX ? thumbUrl(id) : previewUrl(id))
  const [broken, setBroken] = useState<string | null>(null)
  // 자르기 위치 계산에 원본 크기 필요. Baby 에 없어 자산 상세 조회(크기 불변).
  const asset = useQuery({
    ...assetQuery(id ?? ''),
    enabled: !!id && !!crop,
    staleTime: Infinity,
  })
  const w = asset.data?.width
  const h = asset.data?.height
  // 크기 조회 실패·크기 없음 → 가운데 자르기.
  const style = crop && w && h ? cropStyle(crop, w, h, size) : undefined
  const waiting = !!crop && asset.isPending

  return (
    <span
      aria-hidden
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent-soft font-bold text-accent-ink',
        initialClass(size),
        className,
      )}
      style={{ width: size, height: size }}
    >
      {src && broken !== src
        ? !waiting && (
            <img
              src={src}
              alt=""
              decoding="async"
              onError={() => {
                setBroken(src)
              }}
              style={style}
              className={style ? undefined : 'size-full object-cover'}
            />
          )
        : Array.from(baby.name)[0]}
    </span>
  )
}
