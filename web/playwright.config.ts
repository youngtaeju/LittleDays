import { defineConfig, devices } from '@playwright/test'

// 서버는 compose 스택(docker/stack.sh up)이 담당. 빈 DB 전제.
// desktop 이 첫 가입·업로드, mobile 은 그 데이터로 화면 검사. 공유 DB 라 워커 1개.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  // 업로드 처리 대기 60초 + 나머지 단계. 기본 30초면 개별 대기 시간이 잘림.
  timeout: 90_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:18090',
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      testMatch: 'flow.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: 'mobile',
      testMatch: 'mobile.spec.ts',
      dependencies: ['desktop'],
      use: { ...devices['Pixel 5'] },
    },
  ],
})
