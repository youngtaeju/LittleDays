import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AlbumSummary, Asset } from '@/api/types'
import { Toaster } from '@/components/ui/sonner'
import { initI18n } from '@/i18n'
import ko from '@/locales/ko.json'
import { json, mockFetch } from '@/test/fetch'
import { albumFixture, apiError, assetFixture } from '@/test/fixtures'
import { createTestQueryClient } from '@/test/query'
import { assetKey } from '@/timeline/useTimeline'
import { AlbumPickSheet } from './AlbumPickSheet'

beforeEach(() => {
  initI18n('ko')
})

afterEach(() => {
  vi.restoreAllMocks()
})

const A1 = '00000000-0000-4000-8000-0000000000a1'
const A2 = '00000000-0000-4000-8000-0000000000a2'
const A3 = '00000000-0000-4000-8000-0000000000a3'

const ALBUMS: AlbumSummary[] = [
  albumFixture(A1, { name: '첫 제주 여행' }),
  albumFixture(A2, { name: '목욕 시간' }),
]

type Routes = Parameters<typeof mockFetch>[0]

function setup({
  asset = assetFixture('a', { album_ids: [A1] }),
  albums = () => ALBUMS,
  extra = {},
}: {
  asset?: Asset
  albums?: () => AlbumSummary[]
  extra?: Routes
} = {}) {
  mockFetch({
    'GET /api/albums': () => json(200, albums()),
    'GET /api/assets/a': () => json(200, asset),
    ...extra,
  })
  const qc = createTestQueryClient()
  qc.setQueryData(assetKey('a'), asset)
  const onClose = vi.fn()
  render(
    <QueryClientProvider client={qc}>
      <AlbumPickSheet assetId="a" onClose={onClose} />
      <Toaster />
    </QueryClientProvider>,
  )
  const sheet = () =>
    within(screen.getByRole('dialog', { name: ko.albums.addTo }))
  return { qc, onClose, sheet, user: userEvent.setup() }
}

function deferred() {
  let resolve: (r: Response) => void = () => undefined
  const promise = new Promise<Response>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('AlbumPickSheet', () => {
  it('checks_from_album_ids', async () => {
    const { sheet } = setup()
    const jeju = await sheet().findByRole('checkbox', { name: '첫 제주 여행' })
    expect(jeju).toHaveAttribute('aria-checked', 'true')
    expect(
      sheet().getByRole('checkbox', { name: '목욕 시간' }),
    ).toHaveAttribute('aria-checked', 'false')
    expect(
      sheet().getByRole('button', { name: ko.albums.createAndAdd }),
    ).toBeInTheDocument()
  })

  it('toggle_optimistic', async () => {
    const adds: unknown[] = []
    const removes: unknown[] = []
    const addResponse = deferred()
    let server: string[] = [A1]
    let assetGets = 0
    let albumGets = 0
    const { qc, sheet, user } = setup({
      albums: () => {
        albumGets += 1
        return ALBUMS
      },
      extra: {
        'GET /api/assets/a': () => {
          assetGets += 1
          return json(200, assetFixture('a', { album_ids: server }))
        },
        [`POST /api/albums/${A2}/assets`]: async (req) => {
          adds.push(await req.json())
          const res = await addResponse.promise
          server = [...server, A2]
          return res
        },
        [`POST /api/albums/${A1}/assets/remove`]: async (req) => {
          removes.push(await req.json())
          server = server.filter((x) => x !== A1)
          return json(204, null)
        },
      },
    })
    const bath = await sheet().findByRole('checkbox', { name: '목욕 시간' })
    await user.click(bath)
    // 응답 전 즉시 체크, 상세 캐시도 반영.
    expect(bath).toHaveAttribute('aria-checked', 'true')
    expect(qc.getQueryData<Asset>(assetKey('a'))?.album_ids).toEqual([A1, A2])
    await waitFor(() => {
      expect(adds).toEqual([{ asset_ids: ['a'] }])
    })
    addResponse.resolve(json(204, null))

    const jeju = sheet().getByRole('checkbox', { name: '첫 제주 여행' })
    await user.click(jeju)
    expect(jeju).toHaveAttribute('aria-checked', 'false')
    await waitFor(() => {
      expect(removes).toEqual([{ asset_ids: ['a'] }])
    })
    // 끝나면 상세 다시 받음(album_ids 서버 값).
    await waitFor(() => {
      expect(assetGets).toBeGreaterThan(0)
    })
    await waitFor(() => {
      expect(qc.getQueryData<Asset>(assetKey('a'))?.album_ids).toEqual([A2])
    })
    expect(bath).toHaveAttribute('aria-checked', 'true')
    expect(jeju).toHaveAttribute('aria-checked', 'false')
    // 앨범 개수, 표지 갱신.
    await waitFor(() => {
      expect(albumGets).toBeGreaterThan(1)
    })
  })

  it('toggle_rollback', async () => {
    const { qc, sheet, user } = setup({
      extra: {
        [`POST /api/albums/${A2}/assets`]: () =>
          apiError(404, 'asset.notFound'),
      },
    })
    const bath = await sheet().findByRole('checkbox', { name: '목욕 시간' })
    await user.click(bath)
    expect(
      await screen.findByText(ko.errors.asset.notFound),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(bath).toHaveAttribute('aria-checked', 'false')
    })
    expect(qc.getQueryData<Asset>(assetKey('a'))?.album_ids).toEqual([A1])
  })

  it('create_and_add', async () => {
    const bodies: unknown[] = []
    let created = false
    const { qc, sheet, user } = setup({
      albums: () =>
        created ? [albumFixture(A3, { name: '할머니 댁' }), ...ALBUMS] : ALBUMS,
      extra: {
        'GET /api/assets/a': () =>
          json(
            200,
            assetFixture('a', { album_ids: created ? [A1, A3] : [A1] }),
          ),
        'POST /api/albums': async (req) => {
          bodies.push(await req.json())
          created = true
          return json(
            201,
            albumFixture(A3, { name: '할머니 댁', photo_count: 1 }),
          )
        },
      },
    })
    await user.click(
      await sheet().findByRole('button', { name: ko.albums.createAndAdd }),
    )
    const dialog = await screen.findByRole('dialog', { name: ko.albums.new })
    await user.type(
      within(dialog).getByLabelText(ko.albums.nameLabel),
      '할머니 댁',
    )
    await user.click(
      within(dialog).getByRole('button', { name: ko.albums.create }),
    )
    await waitFor(() => {
      expect(bodies).toEqual([{ name: '할머니 댁', asset_ids: ['a'] }])
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: ko.albums.new })).toBeNull()
    })
    // 시트는 남고 새 앨범이 체크된 채로 나타남.
    const grandma = await sheet().findByRole('checkbox', { name: '할머니 댁' })
    expect(grandma).toHaveAttribute('aria-checked', 'true')
    expect(qc.getQueryData<Asset>(assetKey('a'))?.album_ids).toContain(A3)
  })
})
