import { screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, call } from '@/api/client'
import type { User } from '@/api/types'
import { meQueryKey } from '@/auth/session'
import { initI18n, pickLocale } from '@/i18n'
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

  describe('wizard', () => {
    const w = ko.auth.wizard

    function wizardRoutes(babies: unknown[], signups: unknown[] = []) {
      return {
        ...emptyFeedRoutes,
        'GET /api/auth/status': () => json(200, { signup_open: true }),
        'GET /api/settings': () => json(200, settingsFixture),
        'POST /api/auth/signup': async (req: Request) => {
          signups.push(await req.json())
          return json(201, { user: userFixture('owner') })
        },
        'POST /api/babies': async (req: Request) => {
          babies.push(await req.json())
          return json(201, {
            id: '00000000-0000-4000-8000-0000000000b1',
            name: '하늘',
            birth_date: '2026-05-01',
            sex: null,
            avatar_asset_id: null,
            sort_order: 0,
          })
        },
      }
    }

    async function toStep2(app: ReturnType<typeof renderApp>) {
      await app.user.type(
        await screen.findByLabelText(w.instanceName),
        '하늘이네',
      )
      await app.user.keyboard('{Enter}')
      await screen.findByLabelText(ko.auth.displayName)
    }

    async function fillAccount(app: ReturnType<typeof renderApp>) {
      await app.user.type(screen.getByLabelText(ko.auth.displayName), '엄마')
      await app.user.type(screen.getByLabelText(ko.auth.username), 'owner')
      await app.user.type(screen.getByLabelText(ko.auth.password), 'pw123456')
    }

    it('wizard_steps_and_back', async () => {
      browserLanguage('ko-KR')
      mockFetch(wizardRoutes([]))
      const app = renderApp('/signup')
      const { user } = app

      expect(
        await screen.findByRole('img', {
          name: w.stepOf.replace('{{step}}', '1').replace('{{total}}', '4'),
        }),
      ).toBeInTheDocument()
      // 첫 단계는 뒤로 없음.
      expect(
        screen.queryByRole('button', { name: w.back }),
      ).not.toBeInTheDocument()

      await toStep2(app)
      expect(
        screen.getByRole('img', {
          name: w.stepOf.replace('{{step}}', '2').replace('{{total}}', '4'),
        }),
      ).toBeInTheDocument()
      await user.type(screen.getByLabelText(ko.auth.displayName), '엄마')

      await user.click(screen.getByRole('button', { name: w.back }))
      // 뒤로 가도 입력값 유지.
      expect(screen.getByLabelText(w.instanceName)).toHaveValue('하늘이네')
      await user.keyboard('{Enter}')
      expect(await screen.findByLabelText(ko.auth.displayName)).toHaveValue(
        '엄마',
      )
    })

    it('signup_then_baby_calls', async () => {
      browserLanguage('ko-KR')
      const babies: unknown[] = []
      const signups: unknown[] = []
      mockFetch(wizardRoutes(babies, signups))
      const app = renderApp('/signup')
      const { user } = app
      await toStep2(app)
      await fillAccount(app)
      expect(babies).toEqual([])
      await user.click(screen.getByRole('button', { name: w.createAccount }))

      await screen.findByLabelText(w.babyName)
      expect(signups).toEqual([
        {
          username: 'owner',
          display_name: '엄마',
          password: 'pw123456',
          instance_name: '하늘이네',
        },
      ])
      expect(app.queryClient.getQueryData(meQueryKey)).toEqual(
        userFixture('owner'),
      )
      // 가입 뒤에는 1~2단계로 돌아갈 수 없음.
      expect(
        screen.queryByRole('button', { name: w.back }),
      ).not.toBeInTheDocument()

      await user.type(screen.getByLabelText(w.babyName), '하늘')
      await user.type(screen.getByLabelText(w.babyBirth), '2026-05-01')
      await user.keyboard('{Enter}')

      await screen.findByRole('heading', { name: w.doneTitle })
      expect(babies).toEqual([{ name: '하늘', birth_date: '2026-05-01' }])
      await user.click(screen.getByRole('button', { name: w.goHome }))
      await waitFor(() => {
        expect(app.router.state.location.pathname).toBe('/')
      })
      await screen.findAllByText(settingsFixture.instance_name)
    })

    it('skip_baby', async () => {
      browserLanguage('ko-KR')
      const babies: unknown[] = []
      mockFetch(wizardRoutes(babies))
      const app = renderApp('/signup')
      await toStep2(app)
      await fillAccount(app)
      await app.user.click(
        screen.getByRole('button', { name: w.createAccount }),
      )
      await app.user.click(await screen.findByRole('button', { name: w.skip }))
      await screen.findByRole('heading', { name: w.doneTitle })
      expect(babies).toEqual([])
      expect(screen.queryByText(w.babyLater)).not.toBeInTheDocument()
    })

    it('baby_failure_still_completes', async () => {
      browserLanguage('ko-KR')
      mockFetch({
        ...wizardRoutes([]),
        'POST /api/babies': () => apiError(400, 'babies.nameInvalid'),
      })
      const app = renderApp('/signup')
      await toStep2(app)
      await fillAccount(app)
      await app.user.click(
        screen.getByRole('button', { name: w.createAccount }),
      )
      await app.user.type(await screen.findByLabelText(w.babyName), '하늘')
      await app.user.type(screen.getByLabelText(w.babyBirth), '2026-05-01')
      await app.user.keyboard('{Enter}')
      await screen.findByRole('heading', { name: w.doneTitle })
      expect(screen.getByText(w.babyLater)).toBeInTheDocument()
    })

    it('signup_error_returns_to_field', async () => {
      browserLanguage('ko-KR')
      mockFetch({
        ...wizardRoutes([]),
        'POST /api/auth/signup': () => apiError(409, 'auth.usernameTaken'),
      })
      const app = renderApp('/signup')
      await toStep2(app)
      await fillAccount(app)
      await app.user.click(
        screen.getByRole('button', { name: w.createAccount }),
      )
      const username = screen.getByLabelText(ko.auth.username)
      expect(
        await screen.findByText(ko.errors.auth.usernameTaken),
      ).toBeInTheDocument()
      expect(username).toHaveFocus()
      expect(username).toBeInvalid()
      // 입력값 유지.
      expect(screen.getByLabelText(ko.auth.displayName)).toHaveValue('엄마')
    })

    it('signup_instance_error_returns_to_step1', async () => {
      browserLanguage('ko-KR')
      mockFetch({
        ...wizardRoutes([]),
        'POST /api/auth/signup': () =>
          apiError(400, 'settings.instanceNameInvalid'),
      })
      const app = renderApp('/signup')
      await toStep2(app)
      await fillAccount(app)
      await app.user.click(
        screen.getByRole('button', { name: w.createAccount }),
      )
      expect(
        await screen.findByText(ko.errors.settings.instanceNameInvalid),
      ).toBeInTheDocument()
      expect(screen.getByLabelText(w.instanceName)).toHaveFocus()
    })

    it('wizard_moves_focus_and_announces_step', async () => {
      browserLanguage('ko-KR')
      mockFetch(wizardRoutes([]))
      const app = renderApp('/signup')
      await toStep2(app)
      expect(
        screen.getByRole('heading', { name: w.accountTitle }),
      ).toHaveFocus()
      expect(screen.getByText('2 / 4 단계')).toBeInTheDocument()
    })

    it('signup_closed_offers_login_link', async () => {
      browserLanguage('ko-KR')
      mockFetch({
        ...wizardRoutes([]),
        'POST /api/auth/signup': () => apiError(403, 'auth.signupClosed'),
      })
      const app = renderApp('/signup')
      await toStep2(app)
      await fillAccount(app)
      await app.user.click(
        screen.getByRole('button', { name: w.createAccount }),
      )
      expect(
        await screen.findByText(ko.errors.auth.signupClosed),
      ).toBeInTheDocument()
      expect(screen.getByRole('link', { name: w.toLogin })).toHaveAttribute(
        'href',
        '/login',
      )
    })

    it('password_rules_live', async () => {
      browserLanguage('ko-KR')
      mockFetch(wizardRoutes([]))
      const app = renderApp('/signup')
      await toStep2(app)
      const rule = screen.getByText(w.passwordRuleLength)
      expect(rule.closest('li')).toHaveAttribute('data-met', 'false')
      await app.user.type(screen.getByLabelText(ko.auth.password), 'pw12345')
      expect(rule.closest('li')).toHaveAttribute('data-met', 'false')
      await app.user.type(screen.getByLabelText(ko.auth.password), '6')
      expect(rule.closest('li')).toHaveAttribute('data-met', 'true')
      expect(screen.getByRole('status')).toHaveTextContent(w.passwordRulesMet)
    })

    it('signup_applies_selected_language', async () => {
      browserLanguage('ko-KR')
      let patch: unknown
      mockFetch({
        ...wizardRoutes([]),
        'PATCH /api/users/me': async (req) => {
          patch = await req.json()
          return json(200, { user: { ...userFixture('owner'), locale: 'en' } })
        },
      })
      const app = renderApp('/signup')
      const { user } = app
      await user.click(await screen.findByRole('button', { name: 'English' }))
      await user.type(
        await screen.findByLabelText(en.auth.wizard.instanceName),
        'Home',
      )
      await user.keyboard('{Enter}')
      await user.type(await screen.findByLabelText(en.auth.displayName), 'Mom')
      await user.type(screen.getByLabelText(en.auth.username), 'owner')
      await user.type(screen.getByLabelText(en.auth.password), 'pw123456')
      await user.click(
        screen.getByRole('button', { name: en.auth.wizard.createAccount }),
      )
      await screen.findByLabelText(en.auth.wizard.babyName)
      expect(patch).toEqual({ locale: 'en' })
      expect(document.documentElement.lang).toBe('en')
    })
  })
})

describe('forgot_password', () => {
  it('forgot_password_sheet', async () => {
    mockFetch(authRoutes({ me: null }))
    const { user } = renderApp('/login')
    await user.click(
      await screen.findByRole('button', { name: ko.auth.login.forgot }),
    )
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(ko.auth.login.forgotAskAdmin)
    expect(dialog).toHaveTextContent(
      'docker compose exec app /app/littledays reset-password <아이디>',
    )
    expect(
      screen.getByRole('button', { name: ko.common.copy }),
    ).toBeInTheDocument()
  })

  it('login_title_uses_remembered_instance_name', async () => {
    localStorage.setItem('ld.instance.name', '하늘이네')
    mockFetch(authRoutes({ me: null }))
    renderApp('/login')
    expect(
      await screen.findByRole('heading', { name: '하늘이네' }),
    ).toBeInTheDocument()
    localStorage.clear()
  })

  it('settings_load_remembers_instance_name', async () => {
    localStorage.clear()
    const state: { me: User | null } = { me: userFixture('owner') }
    mockFetch(authRoutes(state))
    renderApp('/')
    await waitFor(() => {
      expect(localStorage.getItem('ld.instance.name')).toBe(
        settingsFixture.instance_name,
      )
    })
    localStorage.clear()
  })

  it('language_choice_persists_for_signed_out', async () => {
    localStorage.clear()
    browserLanguage('ko-KR')
    mockFetch(authRoutes({ me: null }))
    const { user } = renderApp('/login')
    await user.click(await screen.findByRole('button', { name: 'English' }))
    expect(localStorage.getItem('ld.lang')).toBe('en')
    expect(pickLocale(null, 'ko-KR')).toBe('en')
    localStorage.clear()
  })

  it('forgot_command_placeholder_is_localized', async () => {
    mockFetch(authRoutes({ me: null }))
    const { user } = renderApp('/login')
    await user.click(await screen.findByRole('button', { name: 'English' }))
    await user.click(
      await screen.findByRole('button', { name: en.auth.login.forgot }),
    )
    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'reset-password <username>',
    )
  })

  it('login_shows_title_and_subtitle', async () => {
    mockFetch(authRoutes({ me: null }))
    renderApp('/login')
    expect(
      await screen.findByRole('heading', { name: 'LittleDays' }),
    ).toBeInTheDocument()
    expect(screen.getByText(ko.auth.login.subtitle)).toBeInTheDocument()
  })
})

describe('invite', () => {
  const raw = 'Ab3_x-9QzT'
  const preview = {
    role: 'guardian',
    instance_name: '우리 가족',
    inviter_display_name: '엄마',
    expires_at: '2026-11-10T00:00:00Z',
  }

  it('invite_shows_inviter', async () => {
    mockFetch({
      ...authRoutes({ me: null }),
      [`GET /api/invites/${raw}/preview`]: () => json(200, preview),
    })
    renderApp(`/invite/${raw}`)

    expect(
      await screen.findByRole('heading', {
        name: '엄마님이 우리 가족에 초대했어요',
      }),
    ).toBeInTheDocument()
    expect(screen.getByText(ko.roles.guardianDesc)).toBeInTheDocument()
  })

  it.each([
    ['expired', 410, ko.auth.invite.error.expired],
    ['used', 410, ko.auth.invite.error.used],
    ['revoked', 410, ko.auth.invite.error.revoked],
    ['notFound', 404, ko.auth.invite.error.notFound],
  ] as const)('invite_error_variants %s', async (key, status, copy) => {
    mockFetch({
      ...authRoutes({ me: null }),
      [`GET /api/invites/${raw}/preview`]: () =>
        apiError(status, `invite.${key}`),
    })
    renderApp(`/invite/${raw}`)

    expect(
      await screen.findByRole('heading', { name: copy.title }),
    ).toBeInTheDocument()
    expect(screen.getByText(copy.action)).toBeInTheDocument()
    expect(screen.queryByLabelText(ko.auth.username)).not.toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: ko.auth.toLogin }),
    ).toBeInTheDocument()
  })

  it('invite_accept', async () => {
    let body: unknown
    mockFetch({
      ...authRoutes({ me: null }),
      [`GET /api/invites/${raw}/preview`]: () => json(200, preview),
      [`POST /api/invites/${raw}/accept`]: async (req) => {
        body = await req.json()
        return json(201, { user: userFixture('guardian') })
      },
    })
    const { router, user, queryClient } = renderApp(`/invite/${raw}`)

    await user.type(await screen.findByLabelText(ko.auth.displayName), '아빠')
    await user.click(screen.getByRole('button', { name: ko.auth.invite.next }))
    // 단계 전환 시 제목으로 포커스, 단계 안내 알림.
    expect(
      await screen.findByRole('heading', { name: ko.auth.invite.accountTitle }),
    ).toHaveFocus()
    expect(screen.getByText('2 / 2 단계')).toBeInTheDocument()

    await user.type(screen.getByLabelText(ko.auth.username), 'dad')
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

  async function fillInvite(app: ReturnType<typeof renderApp>) {
    await app.user.type(
      await screen.findByLabelText(ko.auth.displayName),
      '아빠',
    )
    await app.user.click(
      screen.getByRole('button', { name: ko.auth.invite.next }),
    )
    await app.user.type(await screen.findByLabelText(ko.auth.username), 'dad')
    await app.user.type(screen.getByLabelText(ko.auth.password), 'pw123456')
    await app.user.click(
      screen.getByRole('button', { name: ko.auth.invite.submit }),
    )
  }

  it('invite_accept_applies_selected_language', async () => {
    let patch: unknown
    mockFetch({
      ...authRoutes({ me: null }),
      [`GET /api/invites/${raw}/preview`]: () => json(200, preview),
      [`POST /api/invites/${raw}/accept`]: () =>
        json(201, { user: userFixture('guardian') }),
      'PATCH /api/users/me': async (req) => {
        patch = await req.json()
        return json(200, { user: { ...userFixture('guardian'), locale: 'en' } })
      },
    })
    const app = renderApp(`/invite/${raw}`)
    await app.user.click(await screen.findByRole('button', { name: 'English' }))
    await app.user.type(
      await screen.findByLabelText(en.auth.displayName),
      'Dad',
    )
    await app.user.click(
      screen.getByRole('button', { name: en.auth.invite.next }),
    )
    await app.user.type(screen.getByLabelText(en.auth.username), 'dad')
    await app.user.type(screen.getByLabelText(en.auth.password), 'pw123456')
    await app.user.click(
      screen.getByRole('button', { name: en.auth.invite.submit }),
    )
    await waitFor(() => {
      expect(patch).toEqual({ locale: 'en' })
    })
    expect(document.documentElement.lang).toBe('en')
  })

  it.each([
    ['expired', 410],
    ['revoked', 410],
    ['used', 409],
  ] as const)(
    'invite_invalid_at_accept_shows_error_view %s',
    async (key, status) => {
      mockFetch({
        ...authRoutes({ me: null }),
        [`GET /api/invites/${raw}/preview`]: () => json(200, preview),
        [`POST /api/invites/${raw}/accept`]: () =>
          apiError(status, `invite.${key}`),
      })
      const app = renderApp(`/invite/${raw}`)
      await fillInvite(app)
      expect(
        await screen.findByRole('heading', {
          name: ko.auth.invite.error[key].title,
        }),
      ).toBeInTheDocument()
      expect(
        screen.getByText(ko.auth.invite.error[key].action),
      ).toBeInTheDocument()
      expect(screen.queryByLabelText(ko.auth.password)).not.toBeInTheDocument()
    },
  )

  it('invite_username_taken_returns_to_field', async () => {
    mockFetch({
      ...authRoutes({ me: null }),
      [`GET /api/invites/${raw}/preview`]: () => json(200, preview),
      [`POST /api/invites/${raw}/accept`]: () =>
        apiError(409, 'auth.usernameTaken'),
    })
    const app = renderApp(`/invite/${raw}`)
    await fillInvite(app)
    expect(
      await screen.findByText(ko.errors.auth.usernameTaken),
    ).toBeInTheDocument()
    expect(screen.getByLabelText(ko.auth.username)).toHaveFocus()
  })

  it('auth_layout_hides_language_switch_when_signed_in', async () => {
    mockFetch({
      ...authRoutes({ me: userFixture('owner') }),
    })
    const { router } = renderApp('/')
    await screen.findAllByText(settingsFixture.instance_name)
    await router.navigate({ href: '/no-such-page' })
    await screen.findByRole('heading', { name: ko.notFound.title })
    expect(
      screen.queryByRole('button', { name: 'English' }),
    ).not.toBeInTheDocument()
  })
})
