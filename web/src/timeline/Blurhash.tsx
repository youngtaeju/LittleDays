import { decode } from 'blurhash'
import { useEffect, useRef } from 'react'

const SIZE = 32

// 32x32 로 디코드 후 CSS 로 늘림. 잘못된 해시는 빈 canvas.
export function Blurhash({
  hash,
  className,
}: {
  hash: string
  className?: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, SIZE, SIZE)
    try {
      const image = ctx.createImageData(SIZE, SIZE)
      image.data.set(decode(hash, SIZE, SIZE))
      ctx.putImageData(image, 0, 0)
    } catch {
      // 디코드 실패 시 배경색만.
    }
  }, [hash])

  return (
    <canvas
      ref={ref}
      width={SIZE}
      height={SIZE}
      aria-hidden
      className={className}
    />
  )
}
