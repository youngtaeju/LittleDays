import {
  BABY_NAME,
  OWNER,
  expect,
  expectNoHorizontalOverflow,
  expectThumbnailsLoaded,
  test,
  tiles,
} from './fixtures'

// desktop 이 만든 데이터 사용(사진 2장, 영상 1개).

test('screens_fit_width', async ({ ownerPage: page }) => {
  await page.goto('/')
  await expectThumbnailsLoaded(page, 3)
  await expectNoHorizontalOverflow(page)

  await page.goto('/babies')
  await expect(page.getByText(BABY_NAME).first()).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.goto('/me/trash')
  await expect(page.getByRole('heading', { name: '휴지통' })).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.goto('/family')
  await expect(page.getByText(OWNER.displayName).first()).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.goto('/me')
  await expect(page.getByRole('heading', { name: '설정' })).toBeVisible()
  await expect(page.getByLabel('시간대')).toBeVisible()
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
