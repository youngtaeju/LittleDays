import { onlineManager, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { json, mockFetch } from '@/test/fetch'
import { apiError, assetFixture, babyFixture } from '@/test/fixtures'
import { createTestQueryClient } from '@/test/query'
import { Avatar } from './Avatar'

const AVATAR = '00000000-0000-4000-8000-0000000000a1'

function renderAvatar(...args: Parameters<typeof Avatar>) {
  const [props] = args
  const { container } = render(
    <QueryClientProvider client={createTestQueryClient()}>
      <Avatar {...props} />
    </QueryClientProvider>,
  )
  return container
}

describe('Avatar', () => {
  it('avatar_fallback_initial', () => {
    mockFetch({})
    const el = renderAvatar({ baby: babyFixture({ name: '하늘' }), size: 72 })
    expect(screen.getByText('하')).toBeInTheDocument()
    expect(el.querySelector('img')).toBeNull()
    expect(el.firstElementChild).toHaveStyle({ width: '72px', height: '72px' })
  })

  it('no_crop_center_cover_thumb_for_small', () => {
    mockFetch({})
    const el = renderAvatar({
      baby: babyFixture({ avatar_asset_id: AVATAR }),
      size: 40,
    })
    const img = el.querySelector('img')
    expect(img).toHaveAttribute('src', `/api/assets/${AVATAR}/thumb.webp`)
    expect(img).toHaveClass('object-cover')
  })

  it('crop_uses_asset_size_and_preview_for_large', async () => {
    mockFetch({
      [`GET /api/assets/${AVATAR}`]: () =>
        json(200, assetFixture(AVATAR, { width: 4000, height: 3000 })),
    })
    const el = renderAvatar({
      baby: babyFixture({
        avatar_asset_id: AVATAR,
        avatar_crop: { x: 0.25, y: 0.1, size: 0.5 },
      }),
      size: 72,
    })
    await waitFor(() => {
      expect(el.querySelector('img')).not.toBeNull()
    })
    const img = el.querySelector('img')
    expect(img).toHaveAttribute('src', `/api/assets/${AVATAR}/preview.webp`)
    expect(img).toHaveStyle({ width: '192px', left: '-48px' })
  })

  // 크기 조회 일시정지(오프라인)·실패 → 빈 원 대신 가운데 자르기.
  it('size_unavailable_falls_back_to_center', async () => {
    const crop = { x: 0.25, y: 0.1, size: 0.5 }
    onlineManager.setOnline(false)
    try {
      mockFetch({})
      const offline = renderAvatar({
        baby: babyFixture({ avatar_asset_id: AVATAR, avatar_crop: crop }),
        size: 72,
      })
      expect(offline.querySelector('img')).toHaveClass('object-cover')
    } finally {
      onlineManager.setOnline(true)
    }

    mockFetch({
      [`GET /api/assets/${AVATAR}`]: () => apiError(500, 'internal'),
    })
    const failed = renderAvatar({
      baby: babyFixture({ avatar_asset_id: AVATAR, avatar_crop: crop }),
      size: 40,
    })
    await waitFor(() => {
      expect(failed.querySelector('img')).toHaveClass('object-cover')
    })
  })
})
