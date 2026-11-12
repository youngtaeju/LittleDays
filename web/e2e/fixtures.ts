import fs from 'node:fs'
import path from 'node:path'
import {
  test as base,
  expect,
  type APIRequestContext,
  type Browser,
  type Page,
} from '@playwright/test'
import type {
  Asset,
  AssetPage,
  Baby,
  DayPage,
  GrowthRecord,
  MilestoneSummary,
  Story,
  StorySummary,
  TrashItem,
} from '@/api/types'

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

// 별도 요청 컨텍스트(쿠키 분리)로 소유자 로그인 후 초대 링크 생성. 링크 경로 반환.
export async function createInvitePath(
  request: APIRequestContext,
  role: 'guardian' | 'family' = 'family',
): Promise<string> {
  const res = await request.post('/api/auth/login', {
    data: { username: OWNER.username, password: OWNER.password },
    headers: CSRF,
  })
  expect(res.status(), await res.text()).toBe(200)
  const created = await request.post('/api/invites', {
    data: { role },
    headers: CSRF,
  })
  expect(created.status(), await created.text()).toBeLessThan(300)
  const { url } = (await created.json()) as { url: string }
  return new URL(url).pathname
}

// 가족 역할 초대로 가입한 별도 브라우저 컨텍스트. 소유자 페이지의 /family 에서 초대 링크 생성.
// 호출자가 close() 로 컨텍스트를 닫음.
export async function createFamilyPage(
  owner: Page,
  browser: Browser,
  options: {
    baseURL: string | undefined
    locale: string | undefined
    timezoneId: string | undefined
    displayName: string
    username: string
  },
): Promise<{ guest: Page; close: () => Promise<void> }> {
  await owner.goto('/family')
  // 기본 역할 가족.
  await owner.getByRole('button', { name: '가족 초대하기' }).click()
  await owner.getByRole('button', { name: '초대 링크 만들기' }).click()
  const url = await owner.getByLabel('초대 링크', { exact: true }).inputValue()
  expect(url).toContain('/invite/')

  const context = await browser.newContext({
    baseURL: options.baseURL,
    locale: options.locale,
    timezoneId: options.timezoneId,
  })
  const guest = await context.newPage()
  await guest.goto(url)
  await expect(
    guest.getByRole('heading', {
      name: `${OWNER.displayName}님이 ${INSTANCE_NAME}에 초대했어요`,
    }),
  ).toBeVisible()
  await expect(guest.getByText('사진을 보고 기록을 함께 봐요')).toBeVisible()
  await guest.getByLabel('표시 이름').fill(options.displayName)
  await guest.getByRole('button', { name: '다음' }).click()
  await guest.getByLabel('아이디').fill(options.username)
  await guest.getByLabel('비밀번호').fill('e2e-family-password')
  await guest.getByRole('button', { name: '계정 만들기' }).click()
  await expect(guest).toHaveURL(/\/$/)
  return { guest, close: () => context.close() }
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

// 하루 목록을 끝까지 넘겨 이야기 전부. 이야기 목록 API 없음.
export async function listStories(page: Page): Promise<StorySummary[]> {
  const stories: StorySummary[] = []
  let cursor: string | null = null
  do {
    const query: string = cursor ? `&cursor=${cursor}` : ''
    const res = await page.request.get(`/api/days?limit=100${query}`)
    expect(res.status()).toBe(200)
    const body = (await res.json()) as DayPage
    for (const d of body.items) stories.push(...d.stories)
    cursor = body.next_cursor
  } while (cursor)
  return stories
}

export async function createStory(
  page: Page,
  data: {
    entry_date: string
    body: string
    baby_ids: string[]
    asset_ids: string[]
  },
): Promise<Story> {
  const res = await page.request.post('/api/stories', {
    data,
    headers: CSRF,
  })
  expect(res.status(), await res.text()).toBe(201)
  return (await res.json()) as Story
}

// 이야기에 새로 올려 붙인 사진 이름 앞부분. 정리 때 완전 삭제(다른 테스트의 사진 3장 전제 유지).
export const STORY_FILE = 'story-e2e'

// 이야기 전부와 이름이 prefix 로 시작하는 사진(완전 삭제) 정리. 공유 스택에서 앞 시도가 남긴 것 포함.
export async function resetStories(
  page: Page,
  filePrefix?: string,
): Promise<void> {
  for (const s of await listStories(page)) {
    const res = await page.request.delete(`/api/stories/${s.id}`, {
      headers: CSRF,
    })
    expect(res.status()).toBeLessThan(300)
  }
  if (!filePrefix) return
  for (const item of await listAssets(page)) {
    const a = await getAsset(page, item.id)
    if (!a.original_filename.startsWith(filePrefix)) continue
    await trashAsset(page, a.id)
    const res = await page.request.delete(`/api/assets/${a.id}/permanent`, {
      headers: CSRF,
    })
    expect(res.status()).toBeLessThan(300)
  }
}

// 첫 가입 때 만든 아기(BABY_NAME).
export async function firstBaby(page: Page): Promise<Baby> {
  const res = await page.request.get('/api/babies')
  expect(res.status()).toBe(200)
  const babies = (await res.json()) as Baby[]
  const baby = babies.find((b) => b.name === BABY_NAME)
  if (!baby) throw new Error('아기 없음')
  return baby
}

// 그 아기의 성장 기록과 마일스톤 전부 삭제. 공유 스택에서 앞 시도가 남긴 것 포함.
export async function resetRecords(page: Page, babyId: string): Promise<void> {
  const growth = await page.request.get(`/api/babies/${babyId}/growth`)
  expect(growth.status()).toBe(200)
  for (const r of (await growth.json()) as GrowthRecord[]) {
    const res = await page.request.delete(`/api/growth/${r.id}`, {
      headers: CSRF,
    })
    expect(res.status()).toBeLessThan(300)
  }
  const milestones = await page.request.get(`/api/babies/${babyId}/milestones`)
  expect(milestones.status()).toBe(200)
  for (const m of (await milestones.json()) as MilestoneSummary[]) {
    const res = await page.request.delete(`/api/milestones/${m.id}`, {
      headers: CSRF,
    })
    expect(res.status()).toBeLessThan(300)
  }
}

// API 로 기록 만들기. 화면 폭 검사용.
export async function createRecords(
  page: Page,
  babyId: string,
  data: {
    growth: {
      measured_on: string
      height_cm: number | null
      weight_kg: number | null
      note: string | null
    }
    milestone: { custom_label: string; achieved_on: string; note: string }
  },
): Promise<MilestoneSummary> {
  const g = await page.request.post(`/api/babies/${babyId}/growth`, {
    data: data.growth,
    headers: CSRF,
  })
  expect(g.status(), await g.text()).toBe(201)
  const m = await page.request.post(`/api/babies/${babyId}/milestones`, {
    data: { ...data.milestone, asset_ids: [] },
    headers: CSRF,
  })
  expect(m.status(), await m.text()).toBe(201)
  return (await m.json()) as MilestoneSummary
}

// 데스크톱 사이드바 추가하기 → 추가 시트 항목.
export async function sidebarAdd(page: Page, item: string): Promise<void> {
  await page
    .getByRole('navigation', { name: '주 메뉴' })
    .locator('..')
    .getByRole('button', { name: '추가하기' })
    .click()
  await page
    .getByRole('dialog', { name: '무엇을 남길까요?' })
    .getByRole('button', { name: item })
    .click()
}

// 내용만 다른 JPEG(새 사진으로 업로드). APPn(EXIF 등) 뒤에 주석 세그먼트, 화소와 촬영일은 그대로.
export function uniqueJpeg(tag: string): Buffer {
  const src = fs.readFileSync(FILES.jpg)
  let at = 2
  while (
    src[at] === 0xff &&
    (src[at + 1] ?? 0) >= 0xe0 &&
    (src[at + 1] ?? 0) <= 0xef
  ) {
    at += 2 + src.readUInt16BE(at + 2)
  }
  const text = Buffer.from(tag, 'utf8')
  const head = Buffer.from([0xff, 0xfe, 0, 0])
  head.writeUInt16BE(text.length + 2, 2)
  return Buffer.concat([src.subarray(0, at), head, text, src.subarray(at)])
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

// 데스크톱 사이드바 추가하기 → 추가 시트 → 사진/영상 올리기(기기 선택창). 선택창 대기는 호출 측.
export async function sidebarUpload(page: Page): Promise<void> {
  await sidebarAdd(page, '사진·영상 올리기')
}
