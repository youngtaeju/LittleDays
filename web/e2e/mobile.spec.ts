import {
  BABY_NAME,
  createInvitePath,
  FILES,
  OWNER,
  expect,
  expectNoHorizontalOverflow,
  expectThumbnailsLoaded,
  test,
  tiles,
} from './fixtures'
import type { Page } from '@playwright/test'

type Point = { x: number; y: number }

// 손가락 끌기. Playwright touchscreen 은 누르기만 지원해 CDP 터치 이벤트 사용.
async function touchDrag(page: Page, from: Point, to: Point) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [from],
  })
  const steps = 10
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        {
          x: from.x + ((to.x - from.x) * i) / steps,
          y: from.y + ((to.y - from.y) * i) / steps,
        },
      ],
    })
  }
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  })
  await cdp.detach()
}

async function doubleTap(page: Page, at: Point) {
  await page.touchscreen.tap(at.x, at.y)
  await page.touchscreen.tap(at.x, at.y)
}

// desktop 이 만든 데이터 사용(사진 2장, 영상 1개).

test('screens_fit_width', async ({ ownerPage: page }) => {
  await page.goto('/')
  await expectThumbnailsLoaded(page, 3)
  await expectNoHorizontalOverflow(page)

  // 사진 있는 날의 그날 화면(홈 날짜 링크).
  await page
    .getByRole('main')
    .getByRole('article')
    .first()
    .getByRole('heading')
    .getByRole('link')
    .click()
  await expect(page).toHaveURL(/\/days\//)
  await expect(tiles(page).first()).toBeVisible()
  await expectNoHorizontalOverflow(page)

  // 아기 화면(마지막 본 아기로 이동) → 개월 앨범.
  await page.goto('/babies')
  await expect(page).toHaveURL(/\/babies\/[0-9a-f-]+$/)
  await expect(
    page.getByRole('heading', { level: 1, name: BABY_NAME }),
  ).toBeVisible()
  await expect(
    page.getByRole('region', { name: '개월별 앨범' }).locator('img').first(),
  ).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page
    .getByRole('region', { name: '개월별 앨범' })
    .getByRole('link', { name: '2개월, 2장' })
    .click()
  await expect(page).toHaveURL(/\/age\/2$/)
  await expect(tiles(page)).toHaveCount(2)
  await expectNoHorizontalOverflow(page)

  await page.goto('/me/trash')
  await expect(page.getByRole('heading', { name: '휴지통' })).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.goto('/family')
  await expect(page.getByText(OWNER.displayName).first()).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.goto('/me')
  await expect(
    page.getByRole('heading', { name: OWNER.displayName }),
  ).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.goto('/me/instance')
  await expect(
    page.getByRole('heading', { name: '우리 집 설정' }),
  ).toBeVisible()
  await expect(page.getByLabel('시간대')).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

// 비로그인 화면. ownerPage 와 별개의 새 컨텍스트(쿠키 없음).
test('auth_screens_fit_width', async ({ page, request }) => {
  await page.goto('/login')
  await expect(
    page.getByRole('button', { name: '비밀번호를 잊었어요' }),
  ).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.goto(await createInvitePath(request))
  await expect(page.getByRole('heading', { name: /초대했어요$/ })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.getByLabel('표시 이름').fill('이모')
  await page.getByRole('button', { name: '다음' }).click()
  await expect(
    page.getByRole('heading', { name: '아이디와 비밀번호를 정해 주세요' }),
  ).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.goto('/invite/not-a-real-link')
  await expect(
    page.getByRole('heading', { name: '초대 링크가 올바르지 않아요' }),
  ).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('viewer_nav_buttons_visible', async ({ ownerPage: page }) => {
  await page.goto('/')
  await expect(tiles(page)).toHaveCount(3)
  const prev = page.getByRole('button', { name: '이전' })
  const next = page.getByRole('button', { name: '다음' })

  // 영상이 최신이라 첫 항목. 다음만.
  await page.getByRole('link', { name: /^영상,/ }).click()
  await expect(page.locator('main video')).toBeVisible()
  const videoUrl = page.url()
  await expect(next).toBeInViewport()
  // 재생 버튼으로 재생 시작. 자동 재생 없음.
  const video = page.locator('main video')
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true)
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.paused))
    .toBe(false)
  await expect(prev).toHaveCount(0)
  await expectNoHorizontalOverflow(page)

  // 가운데 사진. 둘 다.
  await next.click()
  await expect(page).not.toHaveURL(videoUrl)
  const middleUrl = page.url()
  await expect(page.locator('main img')).toBeVisible()
  await expect(prev).toBeInViewport()
  await expect(next).toBeInViewport()
  await expectNoHorizontalOverflow(page)

  // 마지막 사진. 이전만. 이동마다 주소 확인 후 다음 클릭.
  await next.click()
  await expect(page).not.toHaveURL(middleUrl)
  await expect(next).toHaveCount(0)
  await expect(prev).toBeInViewport()
  await prev.click()
  await expect(page).toHaveURL(middleUrl)
  await prev.click()
  await expect(page).toHaveURL(videoUrl)
  // 영상으로 돌아가도 버튼 유지.
  await expect(page.locator('main video')).toBeVisible()
  await expect(next).toBeInViewport()
})

test('upload_sheet_and_pill', async ({ ownerPage: page }) => {
  await page.goto('/')
  await expect(tiles(page)).toHaveCount(3)
  // 탭 바 (+) → 선택창 → 아래 확인 시트. 이미 올린 사진이라 "이미 있어요"로 끝남.
  const chooser = page.waitForEvent('filechooser')
  await page
    .getByTestId('tab-bar')
    .getByRole('button', { name: '사진 올리기' })
    .click()
  await (await chooser).setFiles(FILES.jpg)
  const confirm = page.getByRole('dialog', { name: '사진 1장 올리기' })
  await expect(confirm).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await confirm.getByRole('button', { name: '올리기' }).click()

  // 알약은 탭 바 위.
  const pill = page.getByRole('button', { name: '1개 올렸어요' })
  await expect(pill).toBeVisible({ timeout: 30_000 })
  const pillBox = await pill.boundingBox()
  const barBox = await page.getByTestId('tab-bar').boundingBox()
  if (!pillBox || !barBox) throw new Error('알약·탭 바 위치 없음')
  expect(pillBox.y + pillBox.height).toBeLessThanOrEqual(barBox.y)
  await expect(pill).toBeHidden({ timeout: 10_000 })
})

test('viewer_zoom_and_dismiss', async ({ ownerPage: page }) => {
  await page.goto('/')
  await expect(tiles(page)).toHaveCount(3)
  // 첫 사진은 목록 중간(영상이 최신). 다음 항목 있음.
  await page
    .getByRole('link', { name: /^사진,/ })
    .first()
    .click()
  await expect(page).toHaveURL(/\/photos\//)
  const url = page.url()
  await expect(page.getByRole('button', { name: '닫기' })).toBeFocused()
  await expect(page.locator('main img').first()).toBeVisible()

  const viewport = page.viewportSize()
  if (!viewport) throw new Error('화면 크기 없음')
  const center = { x: viewport.width / 2, y: viewport.height / 2 }
  // 확대 단추는 데스크톱 전용(휴대폰은 숨김). 상태 확인용.
  const zoomOut = page.getByRole('button', {
    name: '화면에 맞추기',
    includeHidden: true,
  })
  const zoomIn = page.getByRole('button', {
    name: '크게 보기',
    includeHidden: true,
  })

  // 두 번 눌러 확대 → 가로로 끌어도 넘기지 않고 이동만.
  await doubleTap(page, center)
  await expect(zoomOut).toHaveCount(1)
  await touchDrag(
    page,
    { x: center.x + 80, y: center.y },
    { x: center.x - 120, y: center.y },
  )
  await expect(zoomOut).toHaveCount(1)
  expect(page.url()).toBe(url)

  // 다시 두 번 눌러 맞춤 → 아래로 끌어 닫기.
  await doubleTap(page, center)
  await expect(zoomIn).toHaveCount(1)
  await touchDrag(
    page,
    { x: center.x, y: center.y - 100 },
    { x: center.x, y: center.y + 200 },
  )
  await expect(page).toHaveURL(/\/$/)
})
