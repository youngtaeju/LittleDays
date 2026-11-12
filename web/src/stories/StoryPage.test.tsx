import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Role, Story, StoryComment, User } from '@/api/types'
import { initI18n } from '@/i18n'
import ko from '@/locales/ko.json'
import { json, mockFetch } from '@/test/fetch'
import {
  apiError,
  assetSummaryFixture,
  babyFixture,
  emptyFeedRoutes,
  settingsFixture,
  storyCommentFixture,
  storyFixture,
  userFixture,
} from '@/test/fixtures'
import { renderApp } from '@/test/router'
import { storyKey } from './useStory'

beforeEach(() => {
  initI18n('ko')
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => null,
  )
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

type Routes = Parameters<typeof mockFetch>[0]

const SKY = babyFixture({ birth_date: '2024-01-31' })
const GRANDMA: User = {
  ...userFixture('family'),
  id: '00000000-0000-4000-8000-000000000002',
  display_name: '할머니',
}
const DAD: User = {
  ...userFixture('guardian'),
  id: '00000000-0000-4000-8000-000000000003',
  display_name: '아빠',
}

function me(role: Role): User {
  return { ...userFixture(role), display_name: '엄마' }
}

function setup(opts: {
  role?: Role
  story?: Story
  comments?: StoryComment[]
  extra?: Routes
}) {
  const role = opts.role ?? 'guardian'
  const story =
    opts.story ??
    storyFixture('s', {
      author_id: me(role).id,
      baby_ids: [SKY.id],
    })
  mockFetch({
    ...emptyFeedRoutes,
    'GET /api/auth/me': () => json(200, { user: me(role) }),
    'GET /api/settings': () => json(200, settingsFixture),
    'GET /api/babies': () => json(200, [SKY]),
    'GET /api/users': () => json(200, { users: [me(role), GRANDMA, DAD] }),
    'GET /api/stories/s': () => json(200, story),
    'GET /api/stories/s/comments': () =>
      json(200, { items: opts.comments ?? [], next_cursor: null }),
    ...opts.extra,
  })
  return renderApp('/stories/s')
}

describe('StoryPage', () => {
  it('detail_renders_and_reacts', async () => {
    let liked = false
    const story = () =>
      storyFixture('s', {
        author_id: DAD.id,
        baby_ids: [SKY.id],
        body: `오늘 처음 뒤집었어요\n<@${GRANDMA.id}> 보세요`,
        entry_date: '2024-05-10',
        edited_at: '2024-05-11T00:00:00Z',
        assets: [
          assetSummaryFixture('a2', { local_date: '2024-05-08' }),
          assetSummaryFixture('a1', { local_date: '2024-05-10' }),
        ],
        asset_count: 2,
        liked,
        like_count: liked ? 1 : 0,
        comment_count: 1,
      })
    let likes = 0
    const { user } = setup({
      story: story(),
      comments: [
        storyCommentFixture('c1', { author_id: GRANDMA.id, body: '귀여워요' }),
      ],
      extra: {
        'GET /api/stories/s': () => json(200, story()),
        'PUT /api/stories/s/like': () => {
          likes += 1
          liked = true
          return json(204, null)
        },
        'GET /api/stories/s/likes': () =>
          json(200, [{ user_id: me('guardian').id, created_at: '2024-05-10' }]),
      },
    })

    // 날짜(올해 아님 → 연도), 나이, 쓴 사람, 수정됨.
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: '2024년 5월 10일 금요일',
      }),
    ).toBeInTheDocument()
    const main = screen.getByRole('main')
    expect(within(main).getByText('3개월 10일')).toBeInTheDocument()
    expect(within(main).getByText('아빠')).toBeInTheDocument()
    expect(within(main).getByText(ko.comments.edited)).toBeInTheDocument()
    // 본문 전체와 멘션 강조.
    const mention = within(main).getByText('@할머니')
    expect(mention).toHaveClass('text-accent-ink')
    expect(mention.parentElement).toHaveTextContent(
      '오늘 처음 뒤집었어요 @할머니 보세요',
    )

    // 사진 격자: 이야기 사진 순서, 뷰어는 이야기 출처.
    const grid = within(main).getByRole('list', { name: ko.stories.photoGrid })
    const links = within(grid).getAllByRole('link', { name: /^사진,/ })
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/photos/a2?from=story&of=s',
      '/photos/a1?from=story&of=s',
    ])

    // 하트 → 누른 가족 시트(앱 테마, 어둡게 고정 아님).
    const like = within(main).getByRole('button', { name: ko.reactions.like })
    expect(like).toHaveAttribute('aria-pressed', 'false')
    expect(
      within(main).queryByRole('button', { name: /하트 누른 가족 보기/ }),
    ).toBeNull()
    await user.click(like)
    expect(like).toHaveAttribute('aria-pressed', 'true')
    expect(likes).toBe(1)
    const likers = await within(main).findByRole('button', {
      name: '하트 누른 가족 보기, 1명',
    })
    await user.click(likers)
    const sheet = await screen.findByRole('dialog', {
      name: ko.reactions.likersTitle,
    })
    expect(await within(sheet).findByText('엄마')).toBeInTheDocument()
    expect(sheet.closest('.dark')).toBeNull()
    await user.keyboard('{Escape}')

    // 댓글은 같은 화면 안 목록 + 입력칸.
    const comments = screen.getByRole('region', { name: '댓글 1' })
    expect(await within(comments).findByText('귀여워요')).toBeInTheDocument()
    expect(
      within(comments).getByRole('textbox', { name: ko.comments.input }),
    ).toBeInTheDocument()
  })

  it('author_menu', async () => {
    let deleted = 0
    const { user, router } = setup({
      extra: {
        'DELETE /api/stories/s': () => {
          deleted += 1
          return json(204, null)
        },
      },
    })
    const menu = await screen.findByRole('button', { name: ko.stories.menu })
    await user.click(menu)
    const items = await screen.findByRole('menu')
    expect(items.closest('.dark')).toBeNull()
    expect(
      within(items)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual([ko.stories.edit, ko.stories.delete])

    await user.click(
      within(items).getByRole('menuitem', { name: ko.stories.delete }),
    )
    const dialog = await screen.findByRole('dialog', {
      name: ko.stories.deleteTitle,
    })
    expect(dialog.closest('.dark')).toBeNull()
    await user.click(
      within(dialog).getByRole('button', { name: ko.stories.delete }),
    )
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/')
    })
    expect(deleted).toBe(1)
    expect(await screen.findByText(ko.stories.deleted)).toBeInTheDocument()
  })

  it('author_menu_edit_navigates', async () => {
    const { user, router } = setup({})
    await user.click(
      await screen.findByRole('button', { name: ko.stories.menu }),
    )
    await user.click(
      await screen.findByRole('menuitem', { name: ko.stories.edit }),
    )
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/stories/s/edit')
    })
  })

  // 남의 이야기: 보호자는 지우기만.
  it('guardian_deletes_others_only', async () => {
    const { user } = setup({
      story: storyFixture('s', { author_id: DAD.id }),
    })
    await user.click(
      await screen.findByRole('button', { name: ko.stories.menu }),
    )
    const items = await screen.findByRole('menu')
    expect(
      within(items)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual([ko.stories.delete])
  })

  it('family_comments_only', async () => {
    let posted: unknown = null
    const { user } = setup({
      role: 'family',
      story: storyFixture('s', { author_id: DAD.id }),
      extra: {
        'POST /api/stories/s/comments': async (req) => {
          posted = await req.json()
          return json(201, storyCommentFixture('c1', { body: '좋아요' }))
        },
      },
    })
    expect(await screen.findByText(storyFixture('s').body)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: ko.stories.menu })).toBeNull()
    expect(
      screen.getByRole('button', { name: ko.reactions.like }),
    ).toBeInTheDocument()
    const box = screen.getByRole('textbox', { name: ko.comments.input })
    await user.type(box, '좋아요')
    await user.click(screen.getByRole('button', { name: ko.comments.post }))
    await waitFor(() => {
      expect(posted).toEqual({ body: '좋아요' })
    })
  })

  // 고치기 저장은 상세로 되돌아감(같은 상세를 쌓지 않음). 지우면 이야기 화면을 떠남.
  it('edit_then_delete_leaves_page', async () => {
    let current: Story | null = storyFixture('s', {
      author_id: me('guardian').id,
      baby_ids: [SKY.id],
    })
    const { user, router } = setup({
      extra: {
        'GET /api/stories/s': () =>
          current ? json(200, current) : apiError(404, 'story.notFound'),
        'PATCH /api/stories/s': async (req) => {
          const patch = (await req.json()) as { body: string }
          current = current && { ...current, body: patch.body }
          return json(200, current)
        },
        'DELETE /api/stories/s': () => {
          current = null
          return json(204, null)
        },
      },
    })
    await screen.findByRole('button', { name: ko.stories.menu })
    // 홈에서 들어온 기록.
    await router.navigate({ to: '/' })
    await router.navigate({ to: '/stories/$id', params: { id: 's' } })

    await user.click(
      await screen.findByRole('button', { name: ko.stories.menu }),
    )
    await user.click(
      await screen.findByRole('menuitem', { name: ko.stories.edit }),
    )
    const body = await screen.findByRole('textbox', { name: ko.stories.body })
    await user.clear(body)
    await user.type(body, '고친 이야기')
    await user.click(screen.getByRole('button', { name: ko.common.save }))
    expect(await screen.findByText('고친 이야기')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/stories/s')

    await user.click(screen.getByRole('button', { name: ko.stories.menu }))
    await user.click(
      await screen.findByRole('menuitem', { name: ko.stories.delete }),
    )
    const dialog = await screen.findByRole('dialog', {
      name: ko.stories.deleteTitle,
    })
    await user.click(
      within(dialog).getByRole('button', { name: ko.stories.delete }),
    )
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/')
    })
    expect(screen.queryByText('고친 이야기')).toBeNull()
    expect(
      screen.queryByRole('dialog', { name: ko.stories.deleteTitle }),
    ).toBeNull()
  })

  // 다른 가족이 지운 이야기. 남은 캐시 대신 찾을 수 없음.
  it('deleted_elsewhere_shows_not_found', async () => {
    let gone = false
    const { queryClient } = setup({
      extra: {
        'GET /api/stories/s': () =>
          gone
            ? apiError(404, 'story.notFound')
            : json(200, storyFixture('s', { author_id: me('guardian').id })),
      },
    })
    expect(await screen.findByText(storyFixture('s').body)).toBeInTheDocument()
    gone = true
    await queryClient.invalidateQueries({ queryKey: storyKey('s') })
    expect(
      await screen.findByText(ko.errors.story.notFound),
    ).toBeInTheDocument()
    expect(screen.queryByText(storyFixture('s').body)).toBeNull()
    expect(screen.queryByRole('button', { name: ko.stories.menu })).toBeNull()
  })

  it('not_found_shows_message', async () => {
    setup({
      extra: { 'GET /api/stories/s': () => apiError(404, 'story.notFound') },
    })
    expect(
      await screen.findByText(ko.errors.story.notFound),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: ko.day.home })).toBeInTheDocument()
  })
})
