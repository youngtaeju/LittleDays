import {
  BABY_NAME,
  createFamilyPage,
  FILES,
  INSTANCE_NAME,
  OWNER,
  expect,
  expectThumbnailsLoaded,
  firstBaby,
  getAsset,
  listAssets,
  resetRecords,
  resetStories,
  sidebarAdd,
  sidebarUpload,
  STORY_FILE,
  test,
  tiles,
  trashAsset,
  uniqueJpeg,
} from './fixtures'
import type { Page } from '@playwright/test'
import type { AlbumSummary, AssetPage, Baby, Comment } from '@/api/types'

// 선언 순서대로 실행(워커 1개). 앞 테스트가 만든 계정·사진 사용.
// 첫 테스트 외에는 재시도해도 최종 상태가 같도록 작성(복구까지 한 테스트 안에서).

test('first_signup_and_baby', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
  await page.getByRole('link', { name: '첫 계정 만들기' }).click()
  await expect(page.getByLabel('우리 집 이름')).toBeVisible()
  await page.getByLabel('우리 집 이름').fill(INSTANCE_NAME)
  await page.getByRole('button', { name: '다음' }).click()

  await page.getByLabel('표시 이름').fill(OWNER.displayName)
  await page.getByLabel('아이디').fill(OWNER.username)
  await page.getByLabel('비밀번호').fill(OWNER.password)
  await page.getByRole('button', { name: '계정 만들기' }).click()

  await page.getByLabel('아기 이름').fill(BABY_NAME)
  await page.getByLabel('생일 또는 출산 예정일').fill('2024-03-01')
  await page.getByRole('button', { name: '다음' }).click()

  await expect(page.getByRole('heading', { name: '준비됐어요' })).toBeVisible()
  await page.getByRole('button', { name: '홈으로 가기' }).click()
  await expect(page).toHaveURL(/\/$/)
  // 우리 집 이름은 사이드바와 홈 머리글 왼쪽. 홈 머리글 오른쪽은 아기 알약.
  await expect(
    page.getByText(INSTANCE_NAME).filter({ visible: true }).first(),
  ).toBeVisible()
  await expect(page.getByRole('banner').getByText(BABY_NAME)).toBeVisible()
  await expect(page.getByText('아직 올라온 사진이 없어요')).toBeVisible()
  await expect(tiles(page)).toHaveCount(0)
})

test('upload_and_process', async ({ ownerPage: page }) => {
  await page.goto('/')
  // 사이드바 추가하기 → 추가 시트 → 기기 선택창 → 확인 대화상자 → 올리기.
  const chooser = page.waitForEvent('filechooser')
  await sidebarUpload(page)
  await (await chooser).setFiles([FILES.jpg, FILES.heic, FILES.mp4])
  const confirm = page.getByRole('dialog', {
    name: '사진 2장 · 영상 1개 올리기',
  })
  // 미리보기(blob: 주소, CSP 허용). 브라우저가 못 그리는 HEIC 는 형식 표시.
  await expect
    .poll(() =>
      confirm
        .locator('img')
        .evaluate((e) => e instanceof HTMLImageElement && e.naturalWidth > 0),
    )
    .toBe(true)
  await expect(confirm.getByText('HEIC', { exact: true })).toBeVisible()
  // 아기 1명이면 자동 태그, 고르는 줄 없음.
  await expect(confirm.getByRole('group', { name: '아기' })).toHaveCount(0)
  await confirm.getByRole('button', { name: '올리기' }).click()
  await expect(confirm).toBeHidden()

  // 보던 화면 유지. 진행 알약 → 완료 3초 후 사라짐. 재시도 시엔 "이미 있어요"로 끝나도 완료 집계.
  await expect(page).toHaveURL(/\/$/)
  const done = page.getByRole('button', { name: '3개 올렸어요' })
  await expect(done).toBeVisible({ timeout: 60_000 })
  await expect(done).toBeHidden({ timeout: 10_000 })

  await expect(tiles(page)).toHaveCount(3)
  await expect(page.getByRole('img', { name: '처리 중' })).toHaveCount(0, {
    timeout: 60_000,
  })
  // 촬영일 하루 묶음. 사진 2장인 날 + 영상 1개인 날. 처리 후 촬영 시각 반영(폴링 + 재조회) 대기.
  await expect(page.getByRole('main').getByRole('article')).toHaveCount(2, {
    timeout: 60_000,
  })
  await expect(page.getByRole('img', { name: '처리 실패' })).toHaveCount(0)
  await expectThumbnailsLoaded(page, 3)
  // 아기 1명이면 자동 태그.
  for (const a of await listAssets(page)) expect(a.baby_ids).toHaveLength(1)
})

test('day_page', async ({ ownerPage: page }) => {
  await page.goto('/')
  // 사진 2장인 날의 날짜 머리글 → 그날 화면. 사진 칸 2개, 영상 날은 포함되지 않음.
  const card = page
    .getByRole('main')
    .getByRole('article')
    .filter({ has: page.getByRole('link', { name: /^사진,/ }) })
  await card.getByRole('heading').getByRole('link').click()
  await expect(page).toHaveURL(/\/days\/\d{4}-\d{2}-\d{2}$/)
  await expect(page.getByRole('banner').getByRole('heading')).toBeVisible()
  await expect(page.getByRole('banner')).toContainText('사진 2장')
  await expect(tiles(page)).toHaveCount(2)
  await expectThumbnailsLoaded(page, 2)

  // 이전 날/다음 날 중 하나는 영상 날로 연결. 뒤로가기는 홈.
  await expect(
    page.getByRole('navigation', { name: '이전·다음 날' }),
  ).toBeVisible()
  await page.getByRole('button', { name: '뒤로' }).click()
  await expect(page).toHaveURL(/\/$/)
})

test('baby_age_album', async ({ ownerPage: page }) => {
  await page.goto('/')
  await expect(tiles(page)).toHaveCount(3)
  // 홈 머리글 아바타(아기 1명) → 아기 화면.
  await page.getByRole('banner').getByRole('link', { name: BABY_NAME }).click()
  await expect(page).toHaveURL(/\/babies\/[0-9a-f-]+$/)
  await expect(
    page.getByRole('heading', { level: 1, name: BABY_NAME }),
  ).toBeVisible()
  await expect(
    page.getByRole('list', { name: '기록' }).getByRole('listitem'),
  ).toHaveText(['2사진', '1영상', '2기록한 날'])

  // 2024-03-01 생. 사진 2장(5월 1일) = 2개월, 영상(6월 1일) = 3개월. 최신 개월부터.
  const albums = page.getByRole('region', { name: '개월별 앨범' })
  await expect(albums.getByRole('link')).toHaveCount(2)
  await expect(albums.getByRole('link').first()).toHaveAccessibleName(
    '3개월, 1장',
  )
  await albums.getByRole('link', { name: '2개월, 2장' }).click()
  await expect(page).toHaveURL(/\/babies\/[0-9a-f-]+\/age\/2$/)
  const banner = page.getByRole('banner')
  await expect(banner.getByRole('heading', { name: '2개월' })).toBeVisible()
  await expect(banner).toContainText('2024년 5월 1일 ~ 5월 31일')
  await expect(page.getByRole('main').getByRole('article')).toHaveCount(1)
  await expect(tiles(page)).toHaveCount(2)
  await expectThumbnailsLoaded(page, 2)

  // 뒤로 → 아기 화면.
  await banner.getByRole('button', { name: '뒤로' }).click()
  await expect(page).toHaveURL(/\/babies\/[0-9a-f-]+$/)
})

test('baby_avatar_pick_and_crop', async ({ ownerPage: page }) => {
  await page.goto('/babies')
  await expect(page).toHaveURL(/\/babies\/[0-9a-f-]+$/)
  const id = new URL(page.url()).pathname.split('/').at(-1) ?? ''

  // ⋮ → 아기 정보 고치기 → 우리 사진에서 고르기.
  await page.getByRole('button', { name: '아기 메뉴' }).click()
  await page.getByRole('menuitem', { name: '아기 정보 고치기' }).click()
  const sheet = page.getByRole('dialog', { name: '아기 정보 고치기' })
  await sheet.getByRole('button', { name: '우리 사진에서 고르기' }).click()
  const grid = sheet.getByRole('list', { name: '우리 사진에서 고르기' })
  // 사진 2장(영상 제외).
  await expect(grid.getByRole('button')).toHaveCount(2)
  await grid.getByRole('button').first().click()

  // 원 안 미리보기 로드 후 키보드로 확대·이동.
  const stage = sheet.getByRole('group', { name: '사진 위치' })
  await expect
    .poll(() =>
      stage
        .locator('img')
        .evaluate((e) => e instanceof HTMLImageElement && e.naturalWidth > 0),
    )
    .toBe(true)
  await stage.focus()
  await page.keyboard.press('+')
  await page.keyboard.press('ArrowLeft')
  await sheet.getByRole('button', { name: '이 위치로 정하기' }).click()
  await sheet.getByRole('button', { name: '저장하기' }).click()
  await expect(sheet).toBeHidden()

  // 머리글 아바타(72px = preview) 표시. 저장된 자르기 영역.
  const avatar = page.getByRole('main').locator('img[src$="/preview.webp"]')
  await expect
    .poll(() =>
      avatar
        .first()
        .evaluate((e) => e instanceof HTMLImageElement && e.naturalWidth > 0),
    )
    .toBe(true)
  const res = await page.request.get('/api/babies')
  const baby = ((await res.json()) as Baby[]).find((b) => b.id === id)
  expect(baby?.avatar_asset_id).toBeTruthy()
  expect(baby?.avatar_crop?.size).toBeCloseTo(0.8)
})

test('viewer_edit_trash_restore', async ({ ownerPage: page }) => {
  // 홈 피드가 스크롤되도록 낮은 창.
  await page.setViewportSize({ width: 1280, height: 400 })
  await page.goto('/')
  await expectThumbnailsLoaded(page, 3)
  await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight)
  })
  // 첫 사진은 목록 중간(영상이 최신). 다음 항목 존재.
  const target = page
    .getByRole('main')
    .getByRole('link', { name: /^사진,/ })
    .first()
  await expect(target).toBeInViewport()
  const scrollY = await page.evaluate(() => window.scrollY)
  expect(scrollY).toBeGreaterThan(0)

  await target.click()
  await expect(page).toHaveURL(/\/photos\//)
  const id = new URL(page.url()).pathname.split('/').at(-1) ?? ''

  // 1024px 이상은 오른쪽 고정 패널(모달 아님).
  await page.getByRole('button', { name: '정보', exact: true }).click()
  const info = page.getByRole('complementary', { name: '정보' })
  await info.getByRole('button', { name: '설명 고치기' }).click()
  const caption = `첫 나들이 ${String(test.info().retry)}`
  await info.getByRole('textbox', { name: '설명' }).fill(caption)
  await info.getByRole('button', { name: '저장' }).click()
  await expect(info.getByText(caption)).toBeVisible()

  // 아래 막대 휴지통.
  await page.getByRole('button', { name: '휴지통', exact: true }).click()
  await page
    .getByRole('dialog', { name: '휴지통으로 옮길까요?' })
    .getByRole('button', { name: '휴지통으로 옮기기' })
    .click()
  // 다음 항목으로 교체 이동.
  await expect(page).not.toHaveURL(new RegExp(id))
  await page.getByRole('button', { name: '실행 취소' }).click()
  await expect(page.getByText('복구했어요')).toBeVisible()

  const restored = await getAsset(page, id)
  expect(restored.deleted_at).toBeNull()
  expect(restored.caption).toBe(caption)

  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/$/)
  await expect(tiles(page)).toHaveCount(3)
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeCloseTo(scrollY, 0)
})

test('duplicate_in_trash_restore', async ({ ownerPage: page }) => {
  const items = await listAssets(page)
  const details = await Promise.all(items.map((i) => getAsset(page, i.id)))
  const jpg = details.find((a) => a.original_filename === 'orient6.jpg')
  if (!jpg) throw new Error('orient6.jpg 없음')
  await trashAsset(page, jpg.id)

  await page.goto('/')
  const chooser = page.waitForEvent('filechooser')
  await sidebarUpload(page)
  await (await chooser).setFiles(FILES.jpg)
  await page
    .getByRole('dialog', { name: '사진 1장 올리기' })
    .getByRole('button', { name: '올리기' })
    .click()
  // 휴지통에 있는 중복은 누를 때까지 알약 유지. 눌러 업로드 목록.
  await page
    .getByRole('button', { name: '휴지통에 있는 사진 1개' })
    .click({ timeout: 30_000 })
  const row = page
    .getByRole('dialog', { name: '업로드 목록' })
    .getByRole('list', { name: '업로드 목록' })
    .getByRole('listitem')
    .filter({ hasText: 'orient6.jpg' })
  await expect(row.getByText('휴지통에 있어요')).toBeVisible()
  await row.getByRole('button', { name: '복구' }).click()
  await expect(row.getByText('복구했어요')).toBeVisible()
  await expect(row.getByRole('link', { name: '보기' })).toBeVisible()

  expect((await getAsset(page, jpg.id)).deleted_at).toBeNull()
})

test('invite_family_cannot_upload', async ({
  ownerPage: page,
  browser,
  baseURL,
  locale,
  timezoneId,
}) => {
  const { guest, close } = await createFamilyPage(page, browser, {
    baseURL,
    locale,
    timezoneId,
    displayName: '할머니',
    username: `family${String(test.info().retry)}`,
  })
  try {
    await expect(tiles(guest)).toHaveCount(3)
    await expectThumbnailsLoaded(guest, 3)
    // 주 메뉴: (+) 대신 아기.
    const nav = guest.getByRole('navigation', { name: '주 메뉴' })
    await expect(nav.getByRole('link')).toHaveText([
      '홈',
      '달력',
      '아기',
      '앨범',
      '나',
    ])
    await expect(guest.getByRole('button', { name: '추가하기' })).toHaveCount(0)
    await expect(
      guest.getByRole('button', { name: '사진 올리기' }),
    ).toHaveCount(0)

    // 아기 탭 → 아기 화면. 아기 탭 선택.
    await nav.getByRole('link', { name: '아기' }).click()
    await expect(guest).toHaveURL(/\/babies\/[0-9a-f-]+$/)
    await expect(
      guest.getByRole('heading', { level: 1, name: BABY_NAME }),
    ).toBeVisible()
    await expect(nav.getByRole('link', { name: '아기' })).toHaveAttribute(
      'aria-current',
      'page',
    )

    // 주소 직접 입력도 홈으로.
    await guest.goto('/upload')
    await expect(guest).toHaveURL(/\/$/)
  } finally {
    await close()
  }
})

// 이전 시도가 남긴 하트와 소유자 댓글 제거. 재시도해도 같은 상태에서 시작.
async function resetReactions(page: Page, assetId: string): Promise<void> {
  const headers = { 'X-Requested-With': 'LittleDays' }
  const unlike = await page.request.delete(`/api/assets/${assetId}/like`, {
    headers,
  })
  expect(unlike.status()).toBeLessThan(300)
  const res = await page.request.get(
    `/api/assets/${assetId}/comments?limit=100`,
  )
  expect(res.status()).toBe(200)
  const { items } = (await res.json()) as { items: Comment[] }
  for (const c of items) {
    const del = await page.request.delete(`/api/comments/${c.id}`, { headers })
    expect(del.status()).toBeLessThan(300)
  }
}

test('reactions_round_trip', async ({
  ownerPage: page,
  browser,
  baseURL,
  locale,
  timezoneId,
}) => {
  // 재시도마다 가족이 늘어 이름이 겹치면 멘션 목록 선택이 모호.
  const aunt = `이모${String(test.info().retry)}`
  const { guest, close } = await createFamilyPage(page, browser, {
    baseURL,
    locale,
    timezoneId,
    displayName: aunt,
    username: `aunt${String(test.info().retry)}`,
  })
  try {
    await page.goto('/')
    await expectThumbnailsLoaded(page, 3)
    const photo = tiles(page).first()
    const href = (await photo.getAttribute('href')) ?? ''
    await resetReactions(page, href.split('/').at(-1) ?? '')
    await photo.click()
    await expect(page).toHaveURL(/\/photos\//)
    const photoUrl = page.url()

    const like = page.getByRole('button', { name: '하트', exact: true })
    await expect(like).toHaveAttribute('aria-pressed', 'false')
    await like.click()
    await expect(like).toHaveAttribute('aria-pressed', 'true')
    await expect(
      page.getByRole('button', { name: '하트 누른 가족 보기, 1명' }),
    ).toHaveText('1')

    // 1024px 이상은 오른쪽 댓글 탭. `@` 로 가족 이름 고르기.
    await page.getByRole('button', { name: '댓글 보기, 0개' }).click()
    const panel = page.getByRole('complementary', { name: '댓글' })
    const input = panel.getByRole('textbox', { name: '댓글 입력' })
    await input.click()
    await input.pressSequentially('@')
    await panel
      .getByRole('listbox')
      .getByRole('option', { name: aunt, exact: true })
      .click()
    await input.pressSequentially('고마워요')
    await panel.getByRole('button', { name: '올리기' }).click()
    await expect(panel.getByText(`@${aunt}`, { exact: true })).toBeVisible()
    await expect(panel.getByText(/고마워요/)).toBeVisible()
    await expect(
      page.getByRole('button', { name: '댓글 보기, 1개' }),
    ).toBeVisible()
    // 작성자 본인에게는 메뉴가 있음. 아래 가족 쪽 부재 확인의 양성 대조.
    await expect(panel.getByRole('button', { name: '댓글 메뉴' })).toHaveCount(
      1,
    )

    // 홈 하루 묶음 합계.
    await page.goto('/')
    await expectThumbnailsLoaded(page, 3)
    await expect(
      page
        .getByRole('main')
        .getByRole('article')
        .getByRole('img', { name: '하트 1개, 댓글 1개' }),
    ).toBeVisible()

    // 가족은 남의 댓글을 지울 수 없음(메뉴 자체가 없음).
    await guest.goto(photoUrl)
    await guest.getByRole('button', { name: '댓글 보기, 1개' }).click()
    const guestPanel = guest.getByRole('complementary', { name: '댓글' })
    await expect(guestPanel.getByText(/고마워요/)).toBeVisible()
    await expect(
      guestPanel.getByRole('button', { name: '댓글 메뉴' }),
    ).toHaveCount(0)
    await expect(guest.getByRole('menuitem', { name: '지우기' })).toHaveCount(0)
  } finally {
    await close()
  }
})

// 이전 시도가 남긴 즐겨찾기 제거. 재시도해도 빈 즐겨찾기에서 시작.
async function resetFavorites(page: Page): Promise<void> {
  const headers = { 'X-Requested-With': 'LittleDays' }
  const res = await page.request.get('/api/favorites?limit=100')
  expect(res.status()).toBe(200)
  const { items } = (await res.json()) as AssetPage
  for (const a of items) {
    const del = await page.request.delete(`/api/assets/${a.id}/favorite`, {
      headers,
    })
    expect(del.status()).toBeLessThan(300)
  }
}

test('favorites_flow', async ({ ownerPage: page }) => {
  await resetFavorites(page)
  await page.goto('/')
  await expectThumbnailsLoaded(page, 3)

  // 첫 사진 ★ → 다음 사진 ★. 첫 사진은 목록 중간(영상이 최신)이라 다음 항목 존재.
  await page
    .getByRole('main')
    .getByRole('link', { name: /^사진,/ })
    .first()
    .click()
  await expect(page).toHaveURL(/\/photos\//)
  const star = page.getByRole('button', { name: '즐겨찾기', exact: true })
  await expect(star).toHaveAttribute('aria-pressed', 'false')
  await star.click()
  await expect(star).toHaveAttribute('aria-pressed', 'true')
  const first = new URL(page.url()).pathname
  await page.getByRole('button', { name: '다음', exact: true }).click()
  await expect.poll(() => new URL(page.url()).pathname).not.toBe(first)
  await expect(star).toHaveAttribute('aria-pressed', 'false')
  await star.click()
  await expect(star).toHaveAttribute('aria-pressed', 'true')
  const second = new URL(page.url()).pathname
  await expect
    .poll(async () => {
      const res = await page.request.get('/api/favorites')
      return ((await res.json()) as AssetPage).items.length
    })
    .toBe(2)
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/$/)

  // 앨범 → 즐겨찾기. 최근에 담은 사진이 먼저.
  await page
    .getByRole('navigation', { name: '주 메뉴' })
    .getByRole('link', { name: '앨범' })
    .click()
  await page.getByRole('main').getByRole('link', { name: '즐겨찾기' }).click()
  await expect(page).toHaveURL(/\/albums\/favorites$/)
  await expect(
    page.getByRole('heading', { level: 1, name: '즐겨찾기' }),
  ).toBeVisible()
  await expect(tiles(page)).toHaveCount(2)
  await expectThumbnailsLoaded(page, 2)

  // 즐겨찾기 순서로 넘김. 닫으면 즐겨찾기 화면.
  await tiles(page).first().click()
  await expect(page).toHaveURL(new RegExp(`${second}\\?from=favorites$`))
  await expect(
    page.getByRole('button', { name: '이전', exact: true }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: '다음', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`${first}\\?from=favorites$`))
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/albums\/favorites$/)
  await expect(tiles(page)).toHaveCount(2)
})

test('story_round_trip', async ({
  ownerPage: page,
  browser,
  baseURL,
  locale,
  timezoneId,
}) => {
  const retry = String(test.info().retry)
  await resetStories(page, STORY_FILE)
  const body = `바닷가에서 처음 모래를 만졌어요 ${retry}`
  const { guest, close } = await createFamilyPage(page, browser, {
    baseURL,
    locale,
    timezoneId,
    displayName: `삼촌${retry}`,
    username: `uncle${retry}`,
  })
  try {
    // 쓰기: 본문 + 새 사진 1장(날짜 오늘, 아기 1명 자동). 올리면 상세로.
    // 사이드바 추가하기 → 추가 시트 → 이야기 쓰기.
    await page.goto('/')
    await page
      .getByRole('navigation', { name: '주 메뉴' })
      .locator('..')
      .getByRole('button', { name: '추가하기' })
      .click()
    await page
      .getByRole('dialog', { name: '무엇을 남길까요?' })
      .getByRole('button', { name: '이야기 쓰기' })
      .click()
    await expect(page).toHaveURL(/\/stories\/new$/)
    await page.getByRole('textbox', { name: '이야기' }).fill(body)
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: '새로 올리기' }).click()
    await (
      await chooser
    ).setFiles({
      name: `${STORY_FILE}-${retry}.jpg`,
      mimeType: 'image/jpeg',
      buffer: uniqueJpeg(`${STORY_FILE}-${retry}-${String(Date.now())}`),
    })
    await page.getByRole('button', { name: '올리기', exact: true }).click()
    await expect(page).toHaveURL(/\/stories\/[0-9a-f-]+$/)
    const storyUrl = page.url()
    await expect(page.getByText(body)).toBeVisible()

    // 업로드 마무리 때 서버가 연결 → 상세 재조회. 처리 끝날 때까지 폴링.
    const grid = page.getByRole('list', { name: '붙인 사진' })
    const photo = grid.getByRole('link', { name: /^사진,/ })
    await expect(photo).toHaveCount(1, { timeout: 60_000 })
    await expect(grid.getByRole('img', { name: '처리 중' })).toHaveCount(0, {
      timeout: 60_000,
    })
    await expect
      .poll(() =>
        grid
          .locator('img')
          .evaluate((e) => e instanceof HTMLImageElement && e.naturalWidth > 0),
      )
      .toBe(true)

    // 사진 → 이야기 출처 뷰어. 닫으면 상세.
    await photo.click()
    await expect(page).toHaveURL(/\/photos\/[0-9a-f-]+\?from=story&of=/)
    await expect(page.getByRole('button', { name: '닫기' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(storyUrl)

    // 홈 하루 묶음(오늘, 글과 다른 날 사진 썸네일).
    await page.goto('/')
    const card = page
      .getByRole('main')
      .getByRole('article')
      .filter({ hasText: body })
    await expect(card).toBeVisible()
    await expect(card.getByText('사진 1장')).toBeVisible()
    await expect(
      card.getByRole('link', {
        name: `${OWNER.displayName} 이야기: 바닷가에서 처음 모래를 만졌어요 ${retry}`,
      }),
    ).toHaveAttribute('href', new URL(storyUrl).pathname)

    // 가족: (+) 와 이야기 메뉴 없음, 댓글은 가능.
    await guest.goto(storyUrl)
    await expect(guest.getByText(body)).toBeVisible()
    await expect(guest.getByRole('button', { name: '추가하기' })).toHaveCount(0)
    await expect(
      guest.getByRole('button', { name: '이야기 메뉴' }),
    ).toHaveCount(0)
    const comments = guest.getByRole('region', { name: /^댓글/ })
    await comments.getByRole('textbox', { name: '댓글 입력' }).fill('좋았겠다')
    await comments.getByRole('button', { name: '올리기' }).click()
    await expect(comments.getByText('좋았겠다')).toBeVisible()
    await expect(guest.getByRole('region', { name: '댓글 1' })).toBeVisible()
  } finally {
    await close()
    // 뒤 테스트(홈 사진 3장, 하루 묶음 수) 전제 유지.
    await resetStories(page, STORY_FILE)
  }
})

// 키와 몸무게, 마일스톤을 추가 시트로 기록. 끝나면 지움(뒤 테스트의 하루 묶음 수 유지).
test('records_round_trip', async ({ ownerPage: page }) => {
  const baby = await firstBaby(page)
  await resetRecords(page, baby.id)
  try {
    // 키와 몸무게(아기 1명이라 고르기 없음, 날짜 오늘).
    await page.goto('/')
    await sidebarAdd(page, '키·몸무게 기록')
    const growth = page.getByRole('dialog', { name: '키·몸무게 기록' })
    await growth.getByLabel('키(cm)').fill('88.5')
    await growth.getByLabel('몸무게(kg)').fill('12.3')
    await growth.getByRole('button', { name: '저장' }).click()
    await expect(growth).toBeHidden()

    // 아기 화면 차트에 점 하나.
    await page.goto(`/babies/${baby.id}`)
    const section = page.getByRole('region', { name: '성장' })
    await expect(section.getByText(/^88\.5cm · 12\.3kg · /)).toBeVisible()
    await expect(
      section.getByTestId('growth-points').locator('circle'),
    ).toHaveCount(1)

    // 마일스톤 "혼자 걷기"(범위 안내, 날짜 오늘).
    await sidebarAdd(page, '마일스톤 기록')
    const picker = page.getByRole('dialog', { name: '마일스톤 기록' })
    const walk = picker.getByRole('button', { name: /^혼자 걷기/ })
    await expect(walk).toContainText('보통 8~18개월')
    await walk.click()
    const sheet = page.getByRole('dialog', { name: '혼자 걷기' })
    await sheet.getByLabel('메모').fill('거실에서 세 걸음')
    // 올린 사진에서 한 장(오늘 사진 없음 → 다른 날). 시트 위 시트.
    await sheet.getByRole('button', { name: '올린 사진에서 고르기' }).click()
    const assets = page.getByRole('dialog', { name: '사진 고르기' })
    await assets.getByRole('button', { name: '다른 날' }).click()
    await assets
      .getByRole('button', { name: /^사진,/ })
      .first()
      .click()
    await assets.getByRole('button', { name: '1장 고르기' }).click()
    await expect(assets).toBeHidden()
    await expect(
      sheet.getByRole('list', { name: '사진' }).getByRole('listitem'),
    ).toHaveCount(1)
    await sheet.getByRole('button', { name: '저장' }).click()
    await expect(sheet).toBeHidden()

    // 아기 화면 타임라인.
    const timeline = page
      .getByRole('region', { name: '마일스톤' })
      .getByRole('list', { name: '마일스톤 목록' })
    await expect(timeline.getByRole('link')).toHaveCount(1)
    await expect(timeline.getByRole('link')).toHaveAccessibleName(
      /^혼자 걷기, /,
    )

    // 홈 머리글 날짜 옆 표시, 마일스톤만 있는 날 한 줄은 메모.
    await page.goto('/')
    const card = page
      .getByRole('main')
      .getByRole('article')
      .filter({ hasText: '🎉 혼자 걷기' })
    await expect(card).toBeVisible()
    await expect(card.getByText('거실에서 세 걸음')).toBeVisible()

    // 고르기 시트에서 같은 항목은 흐림 + 날짜. 누르면 상세.
    await sidebarAdd(page, '마일스톤 기록')
    const again = page
      .getByRole('dialog', { name: '마일스톤 기록' })
      .getByRole('button', { name: /^혼자 걷기/ })
    await expect(again).toHaveAttribute('data-recorded', '')
    await expect(again).toContainText('기록함')
    await again.click()
    await expect(page).toHaveURL(/\/milestones\/[0-9a-f-]+$/)
    await expect(
      page.getByRole('heading', { level: 1, name: '혼자 걷기' }),
    ).toBeVisible()
    await expect(
      page.getByText('보통 8~18개월 · 아이마다 시기가 달라요'),
    ).toBeVisible()
    await expect(page.getByText('거실에서 세 걸음')).toBeVisible()

    // 붙인 사진 → 마일스톤 출처 뷰어. 닫으면 상세.
    const detailUrl = page.url()
    await page
      .getByRole('list', { name: '붙인 사진' })
      .getByRole('link', { name: /^사진,/ })
      .click()
    await expect(page).toHaveURL(/\/photos\/[0-9a-f-]+\?from=milestone&of=/)
    await expect(page.getByRole('button', { name: '닫기' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(detailUrl)
  } finally {
    await resetRecords(page, baby.id)
  }
})

// 시간대 tz 의 시각 t 벽시계 값(UTC 로 읽은 ms)과 날짜 부분.
function wallParts(t: number, tz: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(t)
  return Object.fromEntries(
    parts
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, Number(p.value)]),
  )
}

// 인스턴스 시간대 기준 지금의 1년 전 같은 날 정오. taken_at(UTC)과 그 날짜.
function lastYearNoon(tz: string): { taken_at: string; date: string } {
  const now = wallParts(Date.now(), tz)
  const naive = Date.UTC(
    (now.year ?? 0) - 1,
    (now.month ?? 1) - 1,
    now.day ?? 1,
    12,
  )
  const w = wallParts(naive, tz)
  const offset =
    Date.UTC(
      w.year ?? 0,
      (w.month ?? 1) - 1,
      w.day ?? 1,
      w.hour,
      w.minute,
      w.second,
    ) - naive
  return {
    taken_at: new Date(naive - offset).toISOString(),
    date: new Date(naive).toISOString().slice(0, 10),
  }
}

test('calendar_flow', async ({ ownerPage: page }) => {
  await page.goto('/')
  await page
    .getByRole('navigation', { name: '주 메뉴' })
    .getByRole('link', { name: '달력' })
    .click()
  await expect(page).toHaveURL(/\/calendar$/)
  // 사진은 2024년 5월 1일. 달 고르기에서 이동.
  await page.getByRole('button', { name: /^\d{4}년 \d+월$/ }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '2024년 5월', exact: true })
    .click()
  await expect(page).toHaveURL(/month=2024-05/)

  // 2024-03-01 생. 10단위 일수 칸만 숫자(5월 9일 = 70일).
  await expect(
    page
      .getByRole('button', { name: '5월 9일, 생후 70일', exact: true })
      .getByTestId('day-mark'),
  ).toHaveText('70')
  await expect(
    page
      .getByRole('button', { name: '5월 10일, 생후 71일', exact: true })
      .getByTestId('day-mark'),
  ).toHaveCount(0)

  // 기록 없는 칸을 먼저 골라 두면 사진 칸 첫 누름이 "고르기".
  await page
    .getByRole('button', { name: '5월 15일, 생후 76일', exact: true })
    .click()
  await expect(page.getByText('이 날은 기록이 없어요')).toBeVisible()
  const cell = page.getByRole('button', {
    name: '5월 1일, 생후 62일, 사진 2장',
  })
  await expect(cell).toHaveAttribute('aria-pressed', 'false')
  await cell.click()
  await expect(cell).toHaveAttribute('aria-pressed', 'true')
  await expect(page).toHaveURL(/date=2024-05-01/)
  await expect(page.getByRole('link', { name: '그날 보기' })).toBeVisible()

  // 같은 칸을 다시 누르면 그날 화면. 뒤로 오면 같은 달, 같은 칸.
  await cell.click()
  await expect(page).toHaveURL(/\/days\/2024-05-01/)
  await expect(tiles(page)).toHaveCount(2)
  await page.getByRole('banner').getByRole('button', { name: '뒤로' }).click()
  await expect(page).toHaveURL(/\/calendar\?.*month=2024-05/)
  await expect(page).toHaveURL(/date=2024-05-01/)
  await expect(
    page.getByRole('button', { name: '5월 1일, 생후 62일, 사진 2장' }),
  ).toHaveAttribute('aria-pressed', 'true')
})

test('memory_card', async ({ ownerPage: page }) => {
  const headers = { 'X-Requested-With': 'LittleDays' }
  const settings = (await (await page.request.get('/api/settings')).json()) as {
    timezone: string
  }
  const past = lastYearNoon(settings.timezone)
  // 인스턴스 오늘이 2월 29일이면 1년 전 같은 날이 없어 서버 후보 없음.
  const nowWall = wallParts(Date.now(), settings.timezone)
  test.skip(
    nowWall.month === 2 && nowWall.day === 29,
    '인스턴스 오늘이 2월 29일',
  )
  // 2024-05 촬영 사진(fixtures). 이전 시도가 옮긴 값은 후보에서 제외되므로 항상 원래 값을 읽음.
  const photo = (await listAssets(page)).find(
    (a) => a.kind === 'photo' && a.taken_at.startsWith('2024-05'),
  )
  expect(photo).toBeDefined()
  const id = photo?.id ?? ''
  const original = photo?.taken_at ?? ''
  try {
    const patched = await page.request.patch(`/api/assets/${id}`, {
      headers,
      data: { taken_at: past.taken_at },
    })
    expect(patched.status(), await patched.text()).toBeLessThan(300)

    await page.goto('/')
    const card = page.getByRole('link', { name: /1년 전 오늘/ })
    await expect(card).toBeVisible()
    await expect(card.locator('img')).toBeVisible()
    await card.click()
    await expect(page).toHaveURL(new RegExp(`/days/${past.date}`))
    await expect(tiles(page)).toHaveCount(1)
  } finally {
    const restored = await page.request.patch(`/api/assets/${id}`, {
      headers,
      data: { taken_at: original },
    })
    expect(restored.status(), await restored.text()).toBeLessThan(300)
  }
})

const ALBUM_NAME = '가족 여행'

// 이전 시도가 남긴 앨범 제거. 사진은 그대로.
async function resetAlbums(page: Page): Promise<void> {
  const res = await page.request.get('/api/albums')
  expect(res.status()).toBe(200)
  for (const a of (await res.json()) as AlbumSummary[]) {
    if (!a.name.startsWith(ALBUM_NAME)) continue
    const del = await page.request.delete(`/api/albums/${a.id}`, {
      headers: { 'X-Requested-With': 'LittleDays' },
    })
    expect(del.status()).toBeLessThan(300)
  }
}

test('album_round_trip', async ({
  ownerPage: page,
  browser,
  baseURL,
  locale,
  timezoneId,
}) => {
  const retry = String(test.info().retry)
  const name = `${ALBUM_NAME} ${retry}`
  await resetAlbums(page)
  let guestClose: (() => Promise<void>) | undefined
  try {
    // 앨범 탭 → 새 앨범 → 앨범 화면.
    await page.goto('/albums')
    await page.getByRole('button', { name: '새 앨범' }).first().click()
    const dialog = page.getByRole('dialog', { name: '새 앨범' })
    await dialog.getByLabel('앨범 이름').fill(name)
    await dialog.getByRole('button', { name: '만들기' }).click()
    await expect(page).toHaveURL(/\/albums\/[0-9a-f-]+$/)
    const albumUrl = page.url()
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()

    // 사진 추가 → 올린 사진 고르기. 사진 2장.
    await page.getByRole('button', { name: '사진 추가' }).click()
    await page.getByRole('button', { name: '올린 사진 고르기' }).click()
    const picker = page.getByRole('dialog', { name: '사진 고르기' })
    const photos = picker.getByRole('button', { name: /^사진,/ })
    await expect(photos).toHaveCount(2)
    await photos.nth(0).click()
    await photos.nth(1).click()
    await picker.getByRole('button', { name: '2장 고르기' }).click()
    await expect(page.getByText('2개를 담았어요')).toBeVisible()
    const grid = page.getByRole('list', { name: '앨범 사진' })
    await expect(grid.getByRole('link', { name: /^사진,/ })).toHaveCount(2)
    await expect(page.getByText(/^사진 2/)).toBeVisible()

    // 뷰어: 앨범 순서로 넘기기.
    await grid.getByRole('link').first().click()
    await expect(page).toHaveURL(/\/photos\/[0-9a-f-]+\?from=album&of=/)
    const next = page.getByRole('button', { name: '다음', exact: true })
    await next.click()
    await expect(next).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: '이전', exact: true }),
    ).toBeVisible()
    const lastId = new URL(page.url()).pathname.split('/').at(-1) ?? ''

    // ⋮ 앨범에 담기: 체크 끄고 다시 켜기(누르는 즉시 저장).
    const more = page.getByRole('button', { name: '더 보기' })
    await more.click()
    await page.getByRole('menuitem', { name: '앨범에 담기' }).click()
    const sheet = page.getByRole('dialog', { name: '앨범에 담기' })
    const check = sheet.getByRole('checkbox', { name })
    await expect(check).toBeChecked()
    await check.click()
    await expect(check).not.toBeChecked()
    await expect
      .poll(async () => (await getAsset(page, lastId)).album_ids.length)
      .toBe(0)
    await check.click()
    await expect(check).toBeChecked()
    await expect
      .poll(async () => (await getAsset(page, lastId)).album_ids.length)
      .toBe(1)
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)

    // 앨범에서 빼기: 마지막 사진이라 앨범 화면으로. 1장 남음.
    await more.click()
    await page.getByRole('menuitem', { name: '앨범에서 빼기' }).click()
    await expect(page).toHaveURL(albumUrl)
    await expect(grid.getByRole('link', { name: /^사진,/ })).toHaveCount(1)
    await expect(page.getByText(/^사진 1/)).toBeVisible()

    // 가족: 보기만.
    const { guest, close } = await createFamilyPage(page, browser, {
      baseURL,
      locale,
      timezoneId,
      displayName: `고모${retry}`,
      username: `albumfam${retry}`,
    })
    guestClose = close
    await guest.goto(albumUrl)
    await expect(guest.getByRole('heading', { level: 1, name })).toBeVisible()
    const guestGrid = guest.getByRole('list', { name: '앨범 사진' })
    await expect(guestGrid.getByRole('link')).toHaveCount(1)
    await expect(guest.getByRole('button', { name: '사진 추가' })).toHaveCount(
      0,
    )
    await expect(guest.getByRole('button', { name: '고르기' })).toHaveCount(0)
    await expect(guest.getByRole('button', { name: '앨범 메뉴' })).toHaveCount(
      0,
    )
    await guestGrid.getByRole('link').click()
    await expect(guest).toHaveURL(/\/photos\/[0-9a-f-]+\?from=album&of=/)
    await guest.getByRole('button', { name: '더 보기' }).click()
    await expect(
      guest.getByRole('menuitem', { name: '원본 내려받기' }),
    ).toBeVisible()
    await expect(guest.getByRole('menuitem')).toHaveCount(1)
    await guest.keyboard.press('Escape')
    await guest.goto('/albums')
    await expect(
      guest
        .getByRole('main')
        .getByRole('link', { name: new RegExp(`^${name},`) }),
    ).toBeVisible()
    await expect(guest.getByRole('button', { name: '새 앨범' })).toHaveCount(0)
  } finally {
    await guestClose?.()
    await resetAlbums(page)
  }
})

test('tabs_navigation', async ({ ownerPage: page }) => {
  await page.goto('/')
  const nav = page.getByRole('navigation', { name: '주 메뉴' })
  await nav.getByRole('link', { name: '달력' }).click()
  await expect(page).toHaveURL(/\/calendar/)
  await expect(nav.getByRole('link', { name: '달력' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await nav.getByRole('link', { name: '앨범' }).click()
  await expect(page).toHaveURL(/\/albums$/)
  await expect(
    page.getByRole('heading', { level: 1, name: '앨범' }),
  ).toBeVisible()
  await nav.getByRole('link', { name: '나' }).click()
  await expect(page).toHaveURL(/\/me$/)
  await nav.getByRole('link', { name: '홈' }).click()
  await expect(page).toHaveURL(/\/$/)

  // 나 → 우리 집 → 가족. 나 탭이 계속 선택.
  await nav.getByRole('link', { name: '나' }).click()
  await page.getByRole('link', { name: '가족', exact: true }).click()
  await expect(page).toHaveURL(/\/family$/)
  await expect(
    page.getByRole('heading', { name: '가족', level: 1 }),
  ).toBeVisible()
  await expect(nav.getByRole('link', { name: '나' })).toHaveAttribute(
    'aria-current',
    'page',
  )

  // 추가하기는 탭이 아니라 시트.
  await page.getByRole('button', { name: '추가하기' }).click()
  await expect(
    page.getByRole('dialog', { name: '무엇을 남길까요?' }),
  ).toBeVisible()
  await page.keyboard.press('Escape')
})

test('offline_banner', async ({ ownerPage: page, context }) => {
  const banner = page.getByText('연결이 없어 저장된 사진만 보여요')
  await page.goto('/')
  await expectThumbnailsLoaded(page, 3)
  await expect(banner).toBeHidden()

  await context.setOffline(true)
  await expect(banner).toBeVisible()
  await expectThumbnailsLoaded(page, 3)

  await context.setOffline(false)
  await expect(banner).toBeHidden()
})

test('security_headers_and_no_csp_violations', async ({ ownerPage: page }) => {
  const violations: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error' && m.text().includes('Content Security Policy')) {
      violations.push(m.text())
    }
  })

  const res = await page.goto('/')
  if (!res) throw new Error('응답 없음')
  const headers = res.headers()
  expect(headers['content-security-policy']).toContain("script-src 'self'")
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'")
  expect(headers['x-content-type-options']).toBe('nosniff')
  expect(headers['referrer-policy']).toBe('same-origin')
  const api = await page.request.get('/api/auth/me')
  expect(api.headers()['content-security-policy']).toBeTruthy()
  expect(api.headers()['x-content-type-options']).toBe('nosniff')

  await expectThumbnailsLoaded(page, 3)
  // 사진·영상 뷰어(이미지·영상 요소 로드).
  for (const [name, ready] of [
    // 뷰어는 지연 로드. 진입 포커스 = 키 입력 수신 준비 완료(영상은 플레이어, 사진은 닫기 버튼).
    [/^영상,/, page.locator('main [role="group"]')],
    [/^사진,/, page.getByRole('button', { name: '닫기' })],
  ] as const) {
    await page.getByRole('link', { name }).first().click()
    await expect(page).toHaveURL(/\/photos\//)
    await expect(ready).toBeFocused()
    await expect(page.locator('main img, main video').first()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/\/$/)
  }
  const nav = page.getByRole('navigation', { name: '주 메뉴' })
  for (const [name, url] of [
    ['달력', /\/calendar$/],
    ['앨범', /\/albums$/],
  ] as const) {
    await nav.getByRole('link', { name }).click()
    await expect(page).toHaveURL(url)
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
  }
  // 아기, 가족은 나 탭 우리 집에서.
  for (const [name, heading] of [
    ['아기', '아기'],
    ['가족', '가족'],
  ] as const) {
    await nav.getByRole('link', { name: '나' }).click()
    await page
      .getByRole('main')
      .getByRole('link', { name, exact: true })
      .click()
    await expect(
      page.getByRole('heading', { name: heading }).first(),
    ).toBeVisible()
  }
  await nav.getByRole('link', { name: '나' }).click()
  await expect(
    page.getByRole('heading', { name: OWNER.displayName }),
  ).toBeVisible()
  // 휴지통은 나 화면에서.
  await page.getByRole('main').getByRole('link', { name: '휴지통' }).click()
  await expect(
    page.getByRole('heading', { name: '휴지통' }).first(),
  ).toBeVisible()
  // 첫 화면 전체 로드(테마 스크립트·매니페스트 포함).
  await page.reload()
  await expect(
    page.getByRole('heading', { name: '휴지통' }).first(),
  ).toBeVisible()

  expect(violations).toEqual([])
})

test('service_worker_registered', async ({ ownerPage: page }) => {
  await page.goto('/')
  // ready 는 activating 단계에서도 해결. 활성화 완료까지 대기.
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const reg = await navigator.serviceWorker.ready
        return reg.active?.state
      }),
    )
    .toBe('activated')
  // 새로고침 후 페이지 제어.
  await page.reload()
  await expect
    .poll(() =>
      page.evaluate(() => navigator.serviceWorker.controller !== null),
    )
    .toBe(true)
})
