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
  await expect(page.getByText(INSTANCE_NAME)).toBeVisible()
  await expect(page.getByText('첫 사진을 올려 보세요')).toBeVisible()
  await expect(tiles(page)).toHaveCount(0)
})

test('upload_and_process', async ({ ownerPage: page }) => {
  await page.goto('/upload')
  // 업로더·아기 목록 준비 전 선택은 무시됨. 아기 1명이면 기본 태그.
  await expect(page.getByRole('button', { name: '파일 선택' })).toBeEnabled()
  await expect(page.getByRole('checkbox', { name: BABY_NAME })).toBeChecked()
  await page
    .locator('input[type=file]')
    .setInputFiles([FILES.jpg, FILES.heic, FILES.mp4])

  // 재시도 시엔 "이미 있는 사진"으로 끝남. 둘 다 완료 집계.
  await expect(page.getByText('3개 중 3개 완료', { exact: true })).toBeVisible({
    timeout: 60_000,
  })

  await page
    .getByRole('navigation', { name: '주 메뉴' })
    .getByRole('link', { name: '타임라인' })
    .click()
  await expect(tiles(page)).toHaveCount(3)
  await expect(page.getByRole('img', { name: '처리 중' })).toHaveCount(0, {
    timeout: 60_000,
  })
  await expect(page.getByRole('img', { name: '처리 실패' })).toHaveCount(0)
  await expectThumbnailsLoaded(page, 3)
  // 업로드 화면에서 고른 아기 태그.
  for (const a of await listAssets(page)) expect(a.baby_ids).toHaveLength(1)
})

test('viewer_edit_trash_restore', async ({ ownerPage: page }) => {
  // 타임라인이 스크롤되도록 낮은 창.
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
  await expect(page).toHaveURL(/\/photo\//)
  const id = new URL(page.url()).pathname.split('/').at(-1) ?? ''

  await page.getByRole('button', { name: '정보' }).click()
  const info = page.getByRole('dialog', { name: '정보' })
  await info.getByRole('button', { name: '설명 편집' }).click()
  const caption = `첫 나들이 ${String(test.info().retry)}`
  await info.getByRole('textbox', { name: '설명' }).fill(caption)
  await info.getByRole('button', { name: '저장' }).click()
  await expect(info.getByText(caption)).toBeVisible()

  await info.getByRole('button', { name: '휴지통으로 이동' }).click()
  await page
    .getByRole('dialog', { name: '휴지통으로 이동할까요?' })
    .getByRole('button', { name: '휴지통으로 이동' })
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

  await page.goto('/upload')
  await expect(page.getByRole('button', { name: '파일 선택' })).toBeEnabled()
  await page.locator('input[type=file]').setInputFiles(FILES.jpg)
  const row = page
    .getByRole('list', { name: '업로드 목록' })
    .getByRole('listitem')
    .filter({ hasText: 'orient6.jpg' })
  await expect(row.getByText('휴지통에 있음')).toBeVisible({ timeout: 30_000 })
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
  await page.goto('/members')
  // 기본 역할 가족.
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
    await expect(nav.getByRole('link', { name: '타임라인' })).toBeVisible()
    await expect(nav.getByRole('link', { name: '업로드' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: '휴지통' })).toHaveCount(0)

    // 주소 직접 입력도 타임라인으로.
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
    await expect(page).toHaveURL(/\/photo\//)
    await expect(page.locator('main img, main video').first()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/\/$/)
  }
  const nav = page.getByRole('navigation', { name: '주 메뉴' })
  for (const [name, heading] of [
    ['업로드', '업로드'],
    ['아기', '아기'],
    ['휴지통', '휴지통'],
    ['멤버', '멤버'],
    ['설정', '설정'],
  ] as const) {
    await nav.getByRole('link', { name }).click()
    await expect(
      page.getByRole('heading', { name: heading }).first(),
    ).toBeVisible()
  }
  // 첫 화면 전체 로드(테마 스크립트·매니페스트 포함).
  await page.reload()
  await expect(
    page.getByRole('heading', { name: '설정' }).first(),
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
