import { screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, call } from '@/api/client'
import type { User } from '@/api/types'
import { meQueryKey } from '@/auth/session'
import { initI18n } from '@/i18n'
import en from '@/locales/en.json'
import ko from '@/locales/ko.json'
import { json, mockFetch } from '@/test/fetch'
import {
  apiError,
  emptyFeedRoutes,
  settingsFixture,
  userFixture,
} from '@/test/fixtures'
import { renderApp } from '@/test/router'

beforeEach(() => {
  initI18n('ko')
})

afterEach(() => {
  vi.restoreAllMocks()
})

function browserLanguage(lang: string) {
  vi.spyOn(navigator, 'language', 'get').mockReturnValue(lang)
}

// 로그인 화면 공통 요청. me 는 상태 변수로 로그인 전후 응답 전환.
function authRoutes(state: { me: User | null }, signupOpen = false) {
  return {
    ...emptyFeedRoutes,
    'GET /api/auth/me': () =>
      state.me ? json(200, { user: state.me }) : apiError(401, 'auth.required'),
    'GET /api/auth/status': () => json(200, { signup_open: signupOpen }),
    'GET /api/settings': () => json(200, settingsFixture),
  }
}

describe('login', () => {
  it('login_success_goes_to_redirect', async () => {
    const state: { me: User | null } = { me: null }
    let body: unknown
    let csrf: string | null = null
    mockFetch({
      ...authRoutes(state),
      'POST /api/auth/login': async (req) => {
        body = await req.json()
        csrf = req.headers.get('X-Requested-With')
        state.me = userFixture('guardian')
        return json(200, { user: state.me })
      },
    })
    const { router, user } = renderApp('/login?redirect=%2Fbabies')

    await user.type(await screen.findByLabelText(ko.auth.username), 'mom')
    await user.type(screen.getByLabelText(ko.auth.password), 'pw123456')
    await user.click(screen.getByRole('button', { name: ko.auth.login.submit }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/babies')
    })
    expect(body).toEqual({ username: 'mom', password: 'pw123456' })
    expect(csrf).toBe('LittleDays')
    expect(
      (await screen.findAllByText(settingsFixture.instance_name)).length,
    ).toBeGreaterThan(0)
  })

  it.each([
    '//evil.com',
    '/\\evil.com',
    'https://evil.com',
    '/%09/evil.com',
    '/\t/evil.com',
  ])('login_redirect_rejects_external %j', async (target) => {
    const state: { me: User | null } = { me: null }
    mockFetch({
      ...authRoutes(state),
      'POST /api/auth/login': () => {
        state.me = userFixture('family')
        return json(200, { user: state.me })
      },
    })
    const { router, user } = renderApp(
      `/login?redirect=${encodeURIComponent(target)}`,
    )

    await user.type(await screen.findByLabelText(ko.auth.username), 'mom')
    await user.type(screen.getByLabelText(ko.auth.password), 'pw123456')
    await user.click(screen.getByRole('button', { name: ko.auth.login.submit }))

    await waitFor(() => {
      expect(router.state.location.href).toBe('/')
    })
    await screen.findAllByText(settingsFixture.instance_name)
  })

  it('login_disabled_shows_error', async () => {
    mockFetch({
      ...authRoutes({ me: null }),
      'POST /api/auth/login': () => apiError(401, 'auth.disabled'),
    })
    const { user } = renderApp('/login')

    await user.type(await screen.findByLabelText(ko.auth.username), 'mom')
    await user.type(screen.getByLabelText(ko.auth.password), 'pw123456')
    await user.click(screen.getByRole('button', { name: ko.auth.login.submit }))

    // 전역 로그아웃이 로케일을 브라우저 언어로 바꿀 수 있음.
    const texts = [ko.errors.auth.disabled, en.errors.auth.disabled]
    expect(
      await screen.findByText((c) => texts.includes(c)),
    ).toBeInTheDocument()
  })

  it('login_invalid_credentials_shows_error', async () => {
    mockFetch({
      ...authRoutes({ me: null }),
      'POST /api/auth/login': () => apiError(401, 'auth.invalidCredentials'),
    })
    const { router, user } = renderApp('/login')

    await user.type(await screen.findByLabelText(ko.auth.username), 'mom')
    await user.type(screen.getByLabelText(ko.auth.password), 'wrong')
    await user.click(screen.getByRole('button', { name: ko.auth.login.submit }))

    expect(
      await screen.findByText(ko.errors.auth.invalidCredentials),
    ).toBeInTheDocument()
    expect(router.state.location.href).toBe('/login')
  })

  it('logged_in_user_leaves_login', async () => {
    mockFetch(authRoutes({ me: userFixture('family') }))
    const { router } = renderApp('/login')
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/')
    })
    await screen.findAllByText(settingsFixture.instance_name)
  })

  it('signup_link_when_open', async () => {
    mockFetch(authRoutes({ me: null }, true))
    const { router, user } = renderApp('/login')
    await user.click(
      await screen.findByRole('link', { name: ko.auth.login.toSignup }),
    )
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/signup')
    })
  })
})

describe('guards', () => {
  it('protected_route_redirects_to_login', async () => {
    mockFetch(authRoutes({ me: null }))
    const { router } = renderApp('/me')
    await waitFor(() => {
      expect(router.state.location.href).toBe('/login?redirect=%2Fme')
    })
    await screen.findByLabelText(ko.auth.username)
  })

  it('role_too_low_redirects_home', async () => {
    mockFetch(authRoutes({ me: userFixture('family') }))
    const { router } = renderApp('/me/trash')
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/me')
    })
    await screen.findAllByText(settingsFixture.instance_name)
  })

  // 오프라인은 로그아웃이 아님. 로그인 화면 대신 오프라인 화면, 경로 유지.
  it('network_error_keeps_protected_route', async () => {
    mockFetch({
      'GET /api/auth/me': () => {
        throw new TypeError('Failed to fetch')
      },
    })
    const { router } = renderApp('/me')
    await screen.findByText(ko.offline.screen)
    expect(router.state.location.href).toBe('/me')
  })

  // 병렬 401 여러 개에도 로그인 이동은 한 번. 캐시는 비우고 me 는 null.
  it('session_loss_redirects_once', async () => {
    browserLanguage('en-US')
    mockFetch({
      ...authRoutes({ me: userFixture('guardian') }),
      'GET /api/babies': () => apiError(401, 'auth.required'),
      'GET /api/auth/sessions': () => json(200, { sessions: [] }),
    })
    const { router, queryClient } = renderApp('/me')
    await screen.findAllByText(settingsFixture.instance_name)
    const before = router.history.length

    queryClient.setQueryData(['stale'], 1)
    const fail = () => call(api.GET('/api/babies'))
    await Promise.allSettled([
      queryClient.query({ queryKey: ['a'], queryFn: fail }),
      queryClient.query({ queryKey: ['b'], queryFn: fail }),
    ])

    await waitFor(() => {
      expect(router.state.location.href).toBe('/login?redirect=%2Fme')
    })
    expect(router.history.length).toBe(before + 1)
    expect(queryClient.getQueryData(['stale'])).toBeUndefined()
    expect(queryClient.getQueryData(meQueryKey)).toBeNull()
    // 비로그인 화면은 브라우저 언어.
    await screen.findByLabelText(en.auth.username)
    expect(document.documentElement.lang).toBe('en')
  })

  it('photo_direct_entry_applies_locale', async () => {
    mockFetch({
      ...authRoutes({ me: { ...userFixture('family'), locale: 'en' } }),
      'GET /api/assets': () => json(200, { items: [], next_cursor: null }),
      'GET /api/assets/x': () => apiError(404, 'asset.notFound'),
    })
    renderApp('/photos/x')
    await screen.findByText(en.errors.asset.notFound)
    expect(document.documentElement.lang).toBe('en')
  })
})

describe('signup', () => {
  it('signup_closed_redirects_to_login', async () => {
    mockFetch(authRoutes({ me: null }, false))
    const { router } = renderApp('/signup')
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login')
    })
    await screen.findByLabelText(ko.auth.username)
  })

  describe('signup_two_steps', () => {
    async function signUp(babyRequests: unknown[]) {
      // 서버 기본 언어(ko)와 같아 언어 맞춤 요청 없음.
      browserLanguage('ko-KR')
      let body: unknown
      mockFetch({
        ...emptyFeedRoutes,
        'GET /api/auth/status': () => json(200, { signup_open: true }),
        'GET /api/settings': () => json(200, settingsFixture),
        'POST /api/auth/signup': async (req) => {
          body = await req.json()
          return json(201, { user: userFixture('owner') })
        },
        'POST /api/babies': async (req) => {
          babyRequests.push(await req.json())
          return json(201, {
            id: '00000000-0000-4000-8000-0000000000b1',
            name: '하늘',
            birth_date: '2026-05-01',
            sex: null,
            avatar_asset_id: null,
            sort_order: 0,
          })
        },
      })
      const app = renderApp('/signup')
      const { user } = app
      await user.type(await screen.findByLabelText(ko.auth.username), 'owner')
      await user.type(screen.getByLabelText(ko.auth.displayName), '엄마')
      await user.type(screen.getByLabelText(ko.auth.password), 'pw123456')
      await user.type(
        screen.getByLabelText(ko.auth.signup.instanceName),
        '우리 가족',
      )
      await user.click(
        screen.getByRole('button', { name: ko.auth.signup.submit }),
      )
      await screen.findByRole('heading', { name: ko.auth.signup.babyTitle })
      expect(screen.getByLabelText(ko.babies.name)).toHaveFocus()
      expect(body).toEqual({
        username: 'owner',
        display_name: '엄마',
        password: 'pw123456',
        instance_name: '우리 가족',
      })
      expect(app.queryClient.getQueryData(meQueryKey)).toEqual(
        userFixture('owner'),
      )
      return app
    }

    it('creates_baby', async () => {
      const babies: unknown[] = []
      const { router, user } = await signUp(babies)

      await user.type(screen.getByLabelText(ko.babies.name), '하늘')
      await user.type(screen.getByLabelText(ko.babies.birthDate), '2026-05-01')
      await user.click(screen.getByRole('button', { name: ko.babies.add }))

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/')
      })
      expect(babies).toEqual([{ name: '하늘', birth_date: '2026-05-01' }])
      await screen.findAllByText(settingsFixture.instance_name)
    })

    it('later_skips_baby', async () => {
      const babies: unknown[] = []
      const { router, user } = await signUp(babies)

      await user.click(
        screen.getByRole('button', { name: ko.auth.signup.later }),
      )

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/')
      })
      expect(babies).toEqual([])
      await screen.findAllByText(settingsFixture.instance_name)
    })
  })
})

describe('signup_locale', () => {
  it('signup_applies_browser_locale', async () => {
    browserLanguage('en-US')
    let patch: unknown
    mockFetch({
      'GET /api/auth/status': () => json(200, { signup_open: true }),
      'POST /api/auth/signup': () => json(201, { user: userFixture('owner') }),
      'PATCH /api/users/me': async (req) => {
        patch = await req.json()
        return json(200, { user: { ...userFixture('owner'), locale: 'en' } })
      },
    })
    const { user, queryClient } = renderApp('/signup')
    await user.type(await screen.findByLabelText(ko.auth.username), 'owner')
    await user.type(screen.getByLabelText(ko.auth.displayName), 'Mom')
    await user.type(screen.getByLabelText(ko.auth.password), 'pw123456')
    await user.type(screen.getByLabelText(ko.auth.signup.instanceName), 'Home')
    await user.click(
      screen.getByRole('button', { name: ko.auth.signup.submit }),
    )

    await screen.findByRole('heading', { name: en.auth.signup.babyTitle })
    expect(patch).toEqual({ locale: 'en' })
    expect(document.documentElement.lang).toBe('en')
    expect(queryClient.getQueryData(meQueryKey)).toMatchObject({
      locale: 'en',
    })
  })
})

describe('invite', () => {
  const raw = 'Ab3_x-9QzT'

  it('invite_expired_shows_message', async () => {
    mockFetch({
      ...authRoutes({ me: null }),
      [`GET /api/invites/${raw}/preview`]: () =>
        apiError(410, 'invite.expired'),
    })
    renderApp(`/invite/${raw}`)

    expect(
      await screen.findByText(ko.errors.invite.expired),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText(ko.auth.username)).not.toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: ko.auth.toLogin }),
    ).toBeInTheDocument()
  })

  it('invite_not_found_shows_message', async () => {
    mockFetch({
      ...authRoutes({ me: null }),
      [`GET /api/invites/${raw}/preview`]: () =>
        apiError(404, 'invite.notFound'),
    })
    renderApp(`/invite/${raw}`)
    expect(
      await screen.findByText(ko.errors.invite.notFound),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText(ko.auth.username)).not.toBeInTheDocument()
  })

  it('invite_accept', async () => {
    let body: unknown
    mockFetch({
      ...authRoutes({ me: null }),
      [`GET /api/invites/${raw}/preview`]: () =>
        json(200, {
          role: 'guardian',
          instance_name: '우리 가족',
          expires_at: '2026-11-10T00:00:00Z',
        }),
      [`POST /api/invites/${raw}/accept`]: async (req) => {
        body = await req.json()
        return json(201, { user: userFixture('guardian') })
      },
    })
    const { router, user, queryClient } = renderApp(`/invite/${raw}`)

    expect(
      await screen.findByRole('heading', {
        name: ko.auth.invite.title.replace('{{instance}}', '우리 가족'),
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        ko.auth.invite.role.replace('{{role}}', ko.roles.guardian),
      ),
    ).toBeInTheDocument()

    await user.type(screen.getByLabelText(ko.auth.username), 'dad')
    await user.type(screen.getByLabelText(ko.auth.displayName), '아빠')
    await user.type(screen.getByLabelText(ko.auth.password), 'pw123456')
    await user.click(
      screen.getByRole('button', { name: ko.auth.invite.submit }),
    )

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/')
    })
    expect(body).toEqual({
      username: 'dad',
      display_name: '아빠',
      password: 'pw123456',
    })
    expect(queryClient.getQueryData(meQueryKey)).toEqual(
      userFixture('guardian'),
    )
    await screen.findAllByText(settingsFixture.instance_name)
  })
})
