import {
  BABY_NAME,
  FILES,
  INSTANCE_NAME,
  OWNER,
  expect,
  expectThumbnailsLoaded,
  getAsset,
  listAssets,
  test,
  tiles,
  trashAsset,
} from './fixtures'
import type { Baby } from '@/api/types'

// 선언 순서대로 실행(워커 1개). 앞 테스트가 만든 계정·사진 사용.
// 첫 테스트 외에는 재시도해도 최종 상태가 같도록 작성(복구까지 한 테스트 안에서).

test('first_signup_and_baby', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
  await page.getByRole('link', { name: '첫 계정 만들기' }).click()
  // 로그인 화면에도 같은 입력란. 가입 화면 전환 후 입력.
  await expect(
    page.getByRole('heading', { name: '첫 계정 만들기' }),
  ).toBeVisible()

  await page.getByLabel('아이디').fill(OWNER.username)
  await page.getByLabel('표시 이름').fill(OWNER.displayName)
  await page.getByLabel('비밀번호').fill(OWNER.password)
  await page.getByLabel('인스턴스 이름').fill(INSTANCE_NAME)
  await page.getByRole('button', { name: '계정 만들기' }).click()

  await expect(page.getByText('첫 아기 추가')).toBeVisible()
  await page.getByLabel('이름').fill(BABY_NAME)
  await page.getByLabel('생년월일').fill('2024-03-01')
  await page.getByRole('button', { name: '아기 추가' }).click()

  await expect(page).toHaveURL(/\/$/)
  // 데스크톱은 사이드바, 휴대폰은 머리글(아기 2명 이상일 때). 아기 1명이면 홈 머리글은 아기 이름.
  await expect(
    page.getByText(INSTANCE_NAME).filter({ visible: true }).first(),
  ).toBeVisible()
  await expect(page.getByRole('banner').getByText(BABY_NAME)).toBeVisible()
  await expect(page.getByText('아직 올라온 사진이 없어요')).toBeVisible()
  await expect(tiles(page)).toHaveCount(0)
})

test('upload_and_process', async ({ ownerPage: page }) => {
  await page.goto('/')
  // 사이드바 버튼 → 기기 선택창 → 확인 대화상자 → 올리기.
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '사진 올리기' }).click()
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
  // 아기 메뉴 → 마지막 본(없으면 첫째) 아기 화면.
  await page
    .getByRole('navigation', { name: '주 메뉴' })
    .getByRole('link', { name: '아기' })
    .click()
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
  await page.getByRole('button', { name: '사진 올리기' }).click()
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
  await page.goto('/family')
  // 기본 역할 가족.
  await page.getByRole('button', { name: '가족 초대하기' }).click()
  await page.getByRole('button', { name: '초대 링크 만들기' }).click()
  const url = await page.getByLabel('초대 링크', { exact: true }).inputValue()
  expect(url).toContain('/invite/')

  const context = await browser.newContext({ baseURL, locale, timezoneId })
  try {
    const guest = await context.newPage()
    await guest.goto(url)
    await expect(
      guest.getByText(`${INSTANCE_NAME}에 초대받았어요`),
    ).toBeVisible()
    await expect(guest.getByText('역할: 가족')).toBeVisible()
    await guest.getByLabel('아이디').fill(`family${String(test.info().retry)}`)
    await guest.getByLabel('표시 이름').fill('할머니')
    await guest.getByLabel('비밀번호').fill('e2e-family-password')
    await guest.getByRole('button', { name: '계정 만들기' }).click()

    await expect(guest).toHaveURL(/\/$/)
    await expect(tiles(guest)).toHaveCount(3)
    await expectThumbnailsLoaded(guest, 3)
    const nav = guest.getByRole('navigation', { name: '주 메뉴' })
    await expect(nav.getByRole('link', { name: '홈' })).toBeVisible()
    await expect(nav.getByRole('link', { name: '가족' })).toBeVisible()
    await expect(
      guest.getByRole('button', { name: '사진 올리기' }),
    ).toHaveCount(0)

    // 주소 직접 입력도 홈으로.
    await guest.goto('/upload')
    await expect(guest).toHaveURL(/\/$/)
  } finally {
    await context.close()
  }
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
  for (const name of [/^영상,/, /^사진,/]) {
    await page.getByRole('link', { name }).first().click()
    await expect(page).toHaveURL(/\/photos\//)
    // 뷰어는 지연 로드. 닫기 버튼 포커스 = 키 입력 수신 준비 완료.
    await expect(page.getByRole('button', { name: '닫기' })).toBeFocused()
    await expect(page.locator('main img, main video').first()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/\/$/)
  }
  const nav = page.getByRole('navigation', { name: '주 메뉴' })
  for (const [name, heading] of [
    ['아기', '아기'],
    ['가족', '가족'],
    ['나', '설정'],
  ] as const) {
    await nav.getByRole('link', { name }).click()
    await expect(
      page.getByRole('heading', { name: heading }).first(),
    ).toBeVisible()
  }
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
