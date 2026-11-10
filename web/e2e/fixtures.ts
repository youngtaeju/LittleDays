import path from 'node:path'
import { test as base, expect, type Page } from '@playwright/test'
import type { Asset, AssetPage, TrashItem } from '@/api/types'

export { expect }

// 빈 DB 첫 가입 계정. desktop·mobile 공용.
// 긴 이름(공백 없음, 393px 초과): 말줄임 누락 시 모바일 가로 넘침 검사에 걸림.
export const OWNER = {
  username: 'owner',
  password: 'e2e-owner-password',
  displayName: '하늘이엄마'.repeat(8),
}
export const INSTANCE_NAME = '우리집 앨범'
export const BABY_NAME = '하늘빛처럼맑은아기'.repeat(4)

const filesDir = path.join(import.meta.dirname, 'files')
// 서버 테스트 fixture 사본. 사진 2장(같은 날), 영상 1개(한 달 뒤).
export const FILES = {
  jpg: path.join(filesDir, 'orient6.jpg'),
  heic: path.join(filesDir, 'rotated.heic'),
  mp4: path.join(filesDir, 'clip-h264.mp4'),
}

const CSRF = { 'X-Requested-With': 'LittleDays' }

// API 로그인. page.request 는 브라우저 컨텍스트와 쿠키 공유.
export async function login(
  page: Page,
  user: { username: string; password: string } = OWNER,
): Promise<void> {
  const res = await page.request.post('/api/auth/login', {
    data: { username: user.username, password: user.password },
    headers: CSRF,
  })
  expect(res.status(), await res.text()).toBe(200)
}

export async function listAssets(page: Page): Promise<AssetPage['items']> {
  const res = await page.request.get('/api/assets?limit=100')
  expect(res.status()).toBe(200)
  const body = (await res.json()) as AssetPage
  return body.items
}

export async function getAsset(page: Page, id: string): Promise<Asset> {
  const res = await page.request.get(`/api/assets/${id}`)
  expect(res.status()).toBe(200)
  return (await res.json()) as Asset
}

export async function trashAsset(page: Page, id: string): Promise<void> {
  const res = await page.request.delete(`/api/assets/${id}`, {
    headers: CSRF,
  })
  expect(res.status()).toBeLessThan(300)
}

// 휴지통 전부 복구. 앞 테스트가 휴지통 이동 후 실패해도 사진 3장 상태로 시작.
async function restoreTrash(page: Page): Promise<void> {
  const res = await page.request.get('/api/trash?limit=500')
  expect(res.status()).toBe(200)
  const { items } = (await res.json()) as { items: TrashItem[] }
  for (const item of items) {
    const r = await page.request.post(`/api/assets/${item.id}/restore`, {
      headers: CSRF,
    })
    expect(r.status()).toBe(200)
  }
}

// 홈 모자이크 칸(뷰어 링크). 라벨은 "사진, …" 또는 "영상, …". "+N" 칸은 제외.
export function tiles(page: Page) {
  return page.getByRole('main').getByRole('link', { name: /^(사진|영상),/ })
}

// 모자이크 칸 이미지 전부 로드 확인. alt="" 라 역할 대신 위치로 선택.
export async function expectThumbnailsLoaded(
  page: Page,
  count: number,
): Promise<void> {
  const imgs = page.getByRole('main').locator('li img')
  await expect(imgs).toHaveCount(count)
  await expect
    .poll(() =>
      imgs.evaluateAll((els) =>
        els.every((e) => e instanceof HTMLImageElement && e.naturalWidth > 0),
      ),
    )
    .toBe(true)
}

// 가로 넘침 없음. 모바일 Chrome 은 넘치면 축소 표시라 innerWidth 도 함께 커짐.
// 기준은 레이아웃 뷰포트 폭(clientWidth).
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(scrollWidth, '가로 넘침').toBeLessThanOrEqual(clientWidth)
}

// 소유자로 로그인한 페이지. 휴지통은 비운 상태(복구)로 시작.
export const test = base.extend<{ ownerPage: Page }>({
  ownerPage: async ({ page }, provide) => {
    await login(page)
    await restoreTrash(page)
    await provide(page)
  },
})
