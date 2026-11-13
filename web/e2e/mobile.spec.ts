import {
  BABY_NAME,
  createInvitePath,
  createRecords,
  createStory,
  FILES,
  OWNER,
  expect,
  expectNoHorizontalOverflow,
  expectThumbnailsLoaded,
  firstBaby,
  listAssets,
  resetRecords,
  resetStories,
  STORY_FILE,
  test,
  tiles,
} from './fixtures'
import type { Page } from '@playwright/test'
import type { Baby } from '@/api/types'

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

  // desktop favorites_flow 가 담은 사진 2장.
  await page.goto('/albums/favorites')
  await expect(page.getByRole('heading', { name: '즐겨찾기' })).toBeVisible()
  await expect(tiles(page)).toHaveCount(2)
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

test('browse_screens_fit_width', async ({ ownerPage: page }) => {
  // 사진이 있는 달(2024년 5월)의 달력. 칸 라벨이 사진 수를 포함.
  await page.goto('/calendar?month=2024-05')
  await expect(
    page.getByRole('button', { name: '5월 1일, 사진 2장' }),
  ).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.goto('/albums')
  await expect(
    page.getByRole('heading', { level: 1, name: '앨범' }),
  ).toBeVisible()
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

// 데스크톱 reactions_round_trip 이 남긴 댓글이 보이는 시트.
test('comment_sheet_fits_width', async ({ ownerPage: page }) => {
  await page.goto('/')
  await expectThumbnailsLoaded(page, 3)
  await tiles(page).first().click()
  await expect(page).toHaveURL(/\/photos\//)
  await page.getByRole('button', { name: /^댓글 보기/ }).click()
  const sheet = page.getByRole('dialog', { name: /^댓글/ })
  await expect(sheet.getByRole('textbox', { name: '댓글 입력' })).toBeVisible()
  await expect(sheet.getByText(/고마워요/)).toBeVisible()
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
  // 탭 바 (+) → 추가 시트 → 선택창 → 아래 확인 시트. 이미 올린 사진이라 "이미 있어요"로 끝남.
  await page
    .getByTestId('tab-bar')
    .getByRole('button', { name: '추가하기' })
    .click()
  const add = page.getByRole('dialog', { name: '무엇을 남길까요?' })
  await expect(add).toBeVisible()
  await expectNoHorizontalOverflow(page)
  const chooser = page.waitForEvent('filechooser')
  await add.getByRole('button', { name: '사진·영상 올리기' }).click()
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

// 영상 날에 사진 2장(다른 날)을 붙인 긴 이야기. 끝나면 지움(뒤 테스트의 하루 묶음 유지).
test('story_screens_fit_width', async ({ ownerPage: page }) => {
  // 앞 데스크톱 시도가 남긴 이야기 사진까지 정리.
  await resetStories(page, STORY_FILE)
  const assets = await listAssets(page)
  const video = assets.find((a) => a.kind === 'video')
  if (!video) throw new Error('영상 없음')
  const res = await page.request.get('/api/babies')
  const babies = (await res.json()) as Baby[]
  // 띄어쓰기 없는 긴 낱말: 줄바꿈 누락 시 가로 넘침.
  const body = `${'모래놀이'.repeat(40)} 바다에 다녀왔어요\n${'파도 소리 '.repeat(30)}`
  const story = await createStory(page, {
    entry_date: video.local_date,
    body,
    baby_ids: babies.map((b) => b.id),
    asset_ids: assets.filter((a) => a.kind === 'photo').map((a) => a.id),
  })
  try {
    // 홈: 영상 날 모자이크 → 메타 줄 → 이야기(3줄 접힘, 다른 날 썸네일).
    await page.goto('/')
    const card = page
      .getByRole('main')
      .getByRole('article')
      .filter({ has: page.getByRole('link', { name: /^영상,/ }) })
    await expect(card.getByText('사진 2장')).toBeVisible()
    const more = card.getByRole('button', { name: '더 보기' })
    await expect(more).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await more.click()
    await expect(card.getByRole('button', { name: '접기' })).toBeFocused()
    await expectNoHorizontalOverflow(page)

    // 이야기 상세.
    await card.getByRole('link', { name: / 이야기: / }).click()
    await expect(page).toHaveURL(new RegExp(`/stories/${story.id}$`))
    await expect(
      page.getByRole('list', { name: '붙인 사진' }).locator('img'),
    ).toHaveCount(2)
    await expect(page.getByRole('textbox', { name: '댓글 입력' })).toBeVisible()
    await expectNoHorizontalOverflow(page)

    // 그날 화면(사진 그리드 뒤 이야기 전체).
    await page.goto(`/days/${video.local_date}`)
    await expect(page.getByRole('link', { name: / 이야기: / })).toBeVisible()
    await expectNoHorizontalOverflow(page)

    // 탭 바 (+) → 이야기 쓰기.
    await page.goto('/')
    await page
      .getByTestId('tab-bar')
      .getByRole('button', { name: '추가하기' })
      .click()
    await page
      .getByRole('dialog', { name: '무엇을 남길까요?' })
      .getByRole('button', { name: '이야기 쓰기' })
      .click()
    await expect(page).toHaveURL(/\/stories\/new$/)
    await expect(page.getByRole('textbox', { name: '이야기' })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  } finally {
    await resetStories(page, STORY_FILE)
  }
})

// 띄어쓰기 없는 긴 이름과 메모의 기록. 끝나면 지움(뒤 시도와 데스크톱 전제 유지).
test('records_screens_fit_width', async ({ ownerPage: page }) => {
  const baby = await firstBaby(page)
  await resetRecords(page, baby.id)
  const label = '처음으로바닷가모래사장을혼자서끝까지걸어갔어요'.slice(0, 30)
  const note = '파도'.repeat(50)
  try {
    // 만들기 도중 실패해도 finally 가 정리.
    const milestone = await createRecords(page, baby.id, {
      growth: {
        measured_on: '2025-03-01',
        height_cm: 80.5,
        weight_kg: 10.25,
        note,
      },
      milestone: { custom_label: label, achieved_on: '2025-03-01', note },
    })
    // 아기 화면(성장, 마일스톤 타임라인).
    await page.goto(`/babies/${baby.id}`)
    const timeline = page.getByRole('list', { name: '마일스톤 목록' })
    await expect(timeline.getByRole('link')).toHaveCount(1)
    await expect(
      page.getByTestId('growth-points').locator('circle'),
    ).toHaveCount(1)
    await expectNoHorizontalOverflow(page)

    // 고르기 시트.
    await page
      .getByRole('region', { name: '마일스톤' })
      .getByRole('button', { name: '마일스톤 기록하기' })
      .click()
    const picker = page.getByRole('dialog', { name: '마일스톤 기록' })
    await expect(
      picker.getByRole('button', { name: /^혼자 걷기/ }),
    ).toBeVisible()
    await expectNoHorizontalOverflow(page)
    const box = await picker.boundingBox()
    expect(box?.width ?? 0).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0)
    await page.keyboard.press('Escape')
    await expect(picker).toBeHidden()

    // 마일스톤 상세.
    await timeline.getByRole('link').click()
    await expect(page).toHaveURL(new RegExp(`/milestones/${milestone.id}$`))
    await expect(page.getByText(note)).toBeVisible()
    await expectNoHorizontalOverflow(page)

    // 성장 기록 목록.
    await page.goto(`/babies/${baby.id}/growth`)
    await expect(
      page
        .getByRole('list', { name: '키와 몸무게 기록' })
        .getByRole('listitem'),
    ).toHaveCount(1)
    await expectNoHorizontalOverflow(page)
  } finally {
    await resetRecords(page, baby.id)
  }
})
