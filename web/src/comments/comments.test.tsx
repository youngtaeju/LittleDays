import { QueryClientProvider } from '@tanstack/react-query'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Comment, Role, StoryComment, User } from '@/api/types'
import { initI18n } from '@/i18n'
import ko from '@/locales/ko.json'
import { json, mockFetch } from '@/test/fetch'
import {
  apiError,
  assetFixture,
  assetSummaryFixture,
  babyFixture,
  commentFixture,
  settingsFixture,
  storyCommentFixture,
  storyFixture,
  userFixture,
} from '@/test/fixtures'
import { createTestQueryClient } from '@/test/query'
import { renderApp } from '@/test/router'
import { storyKey } from '@/stories/useStory'
import { CommentSheet } from './Comments'
import { relativeTime } from './relativeTime'

beforeEach(() => {
  initI18n('ko')
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => null,
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

type Routes = Parameters<typeof mockFetch>[0]

const ME = userFixture('guardian').id
const GRANDMA = '00000000-0000-4000-8000-000000000002'
const MOM = '00000000-0000-4000-8000-00000000000a'
const MOM2 = '00000000-0000-4000-8000-00000000000b'

function family(role: Role, more: User[] = []): User[] {
  return [
    userFixture(role),
    { ...userFixture('family'), id: GRANDMA, display_name: '할머니' },
    ...more,
  ]
}

// 휴대폰 폭 뷰어에서 사진 a 의 댓글 시트를 엶.
async function openSheet(opts: {
  role?: Role
  users?: User[]
  comments: () => Comment[]
  extra?: Routes
}) {
  const role = opts.role ?? 'guardian'
  mockFetch({
    'GET /api/auth/me': () => json(200, { user: userFixture(role) }),
    'GET /api/settings': () => json(200, settingsFixture),
    'GET /api/babies': () => json(200, [babyFixture()]),
    'GET /api/assets': () =>
      json(200, { items: [assetSummaryFixture('a')], next_cursor: null }),
    'GET /api/users': () => json(200, { users: opts.users ?? family(role) }),
    'GET /api/assets/a': () =>
      json(200, assetFixture('a', { comment_count: opts.comments().length })),
    'GET /api/assets/a/comments': () =>
      json(200, { items: opts.comments(), next_cursor: null }),
    ...opts.extra,
  })
  const { user } = renderApp('/photos/a')
  await user.click(await screen.findByRole('button', { name: /댓글 보기/ }))
  const sheet = await screen.findByRole('dialog', { name: /^댓글/ })
  return { user, sheet }
}

function box(sheet: HTMLElement) {
  return within(sheet).getByRole('textbox', { name: ko.comments.input })
}

function postButton(sheet: HTMLElement) {
  return within(sheet).getByRole('button', { name: ko.comments.post })
}

async function itemMenu(
  user: ReturnType<typeof renderApp>['user'],
  item: HTMLElement,
) {
  await user.click(within(item).getByRole('button', { name: ko.comments.menu }))
  return screen.findByRole('menu')
}

describe('comments', () => {
  it('sheet_lists_and_posts', async () => {
    let items = [
      commentFixture('c1', {
        author_id: GRANDMA,
        body: `<@${ME}> 사진 예쁘다\n둘째 줄`,
        edited_at: '2024-05-10T04:00:00Z',
      }),
      commentFixture('c2', { body: '고마워요' }),
    ]
    let posted: unknown
    const { user, sheet } = await openSheet({
      comments: () => items,
      extra: {
        'POST /api/assets/a/comments': async (req) => {
          posted = await req.json()
          const c = commentFixture('c3', { body: '새 댓글' })
          items = [...items, c]
          return json(201, c)
        },
      },
    })
    expect(sheet).toHaveAccessibleName('댓글 2')

    const list = await within(sheet).findAllByRole('listitem')
    expect(list).toHaveLength(2)
    const [first, second] = list as [HTMLElement, HTMLElement]
    expect(within(first).getByText('할머니')).toBeInTheDocument()
    expect(within(first).getByText('@guardian')).toHaveClass('text-accent-ink')
    expect(first).toHaveTextContent('사진 예쁘다')
    expect(within(first).getByText(ko.comments.edited)).toBeInTheDocument()
    expect(first.querySelector('time')).toHaveAttribute(
      'dateTime',
      '2024-05-10T03:00:00Z',
    )
    expect(second).toHaveTextContent('고마워요')
    expect(
      within(second).queryByText(ko.comments.edited),
    ).not.toBeInTheDocument()

    expect(postButton(sheet)).toBeDisabled()
    await user.type(box(sheet), '  새 댓글 ')
    await user.click(postButton(sheet))
    await waitFor(() => {
      expect(within(sheet).getAllByRole('listitem')).toHaveLength(3)
    })
    expect(posted).toEqual({ body: '새 댓글' })
    expect(box(sheet)).toHaveValue('')
  })

  it('counter_counts_code_points', async () => {
    const { sheet } = await openSheet({ comments: () => [] })
    expect(
      await within(sheet).findByText(ko.comments.empty),
    ).toBeInTheDocument()

    fireEvent.change(box(sheet), { target: { value: '😀'.repeat(1001) } })
    expect(within(sheet).getByText('1001/1000')).toHaveClass('text-destructive')
    expect(postButton(sheet)).toBeDisabled()

    fireEvent.change(box(sheet), { target: { value: '😀'.repeat(1000) } })
    expect(within(sheet).queryByText(/\/1000/)).not.toBeInTheDocument()
    expect(postButton(sheet)).toBeEnabled()
  })

  it('edit_own_comment', async () => {
    let items = [commentFixture('c1', { body: `<@${GRANDMA}> 고마워요` })]
    let patched: unknown
    const { user, sheet } = await openSheet({
      comments: () => items,
      extra: {
        'PATCH /api/comments/c1': async (req) => {
          patched = await req.json()
          const c = commentFixture('c1', {
            body: `<@${GRANDMA}> 고마워요!`,
            edited_at: '2024-05-10T05:00:00Z',
          })
          items = [c]
          return json(200, c)
        },
      },
    })
    const [item] = await within(sheet).findAllByRole('listitem')
    if (!item) throw new Error('항목 없음')
    const menu = await itemMenu(user, item)
    await user.click(
      within(menu).getByRole('menuitem', { name: ko.comments.edit }),
    )
    expect(box(sheet)).toHaveValue('@할머니 고마워요')
    expect(within(sheet).getByText(ko.comments.editing)).toBeInTheDocument()

    await user.type(box(sheet), '!')
    await user.click(
      within(sheet).getByRole('button', { name: ko.common.save }),
    )
    expect(await within(sheet).findByText(ko.comments.edited)).toBeVisible()
    expect(patched).toEqual({ body: `<@${GRANDMA}> 고마워요!` })
    expect(
      within(sheet).queryByText(ko.comments.editing),
    ).not.toBeInTheDocument()
    expect(box(sheet)).toHaveValue('')
  })

  it('unchanged_edit_sends_nothing', async () => {
    const { user, sheet } = await openSheet({
      comments: () => [commentFixture('c1', { body: `<@${GRANDMA}> 안녕` })],
    })
    const [item] = await within(sheet).findAllByRole('listitem')
    if (!item) throw new Error('항목 없음')
    const menu = await itemMenu(user, item)
    await user.click(
      within(menu).getByRole('menuitem', { name: ko.comments.edit }),
    )
    // 앞뒤 공백만 다르면 같은 본문. PATCH 가 나가면 미등록 요청으로 실패.
    await user.type(box(sheet), '  ')
    await user.click(
      within(sheet).getByRole('button', { name: ko.common.save }),
    )
    expect(
      within(sheet).queryByText(ko.comments.editing),
    ).not.toBeInTheDocument()
    expect(box(sheet)).toHaveValue('')
  })

  it('family_cannot_delete_others', async () => {
    const { user, sheet } = await openSheet({
      role: 'family',
      comments: () => [
        commentFixture('c1', { author_id: GRANDMA }),
        commentFixture('c2'),
      ],
    })
    const [others, mine] = (await within(sheet).findAllByRole('listitem')) as [
      HTMLElement,
      HTMLElement,
    ]
    expect(
      within(others).queryByRole('button', { name: ko.comments.menu }),
    ).not.toBeInTheDocument()
    const menu = await itemMenu(user, mine)
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual([ko.comments.edit, ko.comments.delete])
  })

  it('guardian_deletes_others', async () => {
    let items = [commentFixture('c1', { author_id: GRANDMA })]
    let deleted = false
    const { user, sheet } = await openSheet({
      comments: () => items,
      extra: {
        'DELETE /api/comments/c1': () => {
          deleted = true
          items = []
          return json(204, null)
        },
      },
    })
    const [item] = await within(sheet).findAllByRole('listitem')
    if (!item) throw new Error('항목 없음')
    const menu = await itemMenu(user, item)
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual([ko.comments.delete])
    await user.click(
      within(menu).getByRole('menuitem', { name: ko.comments.delete }),
    )
    const confirm = await screen.findByRole('dialog', {
      name: ko.comments.deleteTitle,
    })
    expect(confirm).toHaveTextContent(ko.comments.deleteDescription)
    await user.click(
      within(confirm).getByRole('button', { name: ko.comments.delete }),
    )
    expect(
      await within(sheet).findByText(ko.comments.empty),
    ).toBeInTheDocument()
    expect(deleted).toBe(true)
    expect(
      screen.queryByRole('dialog', { name: ko.comments.deleteTitle }),
    ).not.toBeInTheDocument()
  })

  it('edit_focuses_composer', async () => {
    const { user, sheet } = await openSheet({
      comments: () => [commentFixture('c1')],
    })
    const [item] = await within(sheet).findAllByRole('listitem')
    if (!item) throw new Error('항목 없음')
    const menu = await itemMenu(user, item)
    await user.click(
      within(menu).getByRole('menuitem', { name: ko.comments.edit }),
    )
    // 메뉴 닫힘 뒤 ⋯ 로 포커스가 돌아가지 않음.
    await new Promise((r) => setTimeout(r, 50))
    await waitFor(() => {
      expect(box(sheet)).toHaveFocus()
    })
  })

  it('edit_gone_comment_refreshes', async () => {
    let items = [commentFixture('c1')]
    let gets = 0
    const { user, sheet } = await openSheet({
      comments: () => {
        gets++
        return items
      },
      extra: {
        // 다른 가족이 먼저 지움.
        'PATCH /api/comments/c1': () => {
          items = []
          return apiError(404, 'comment.notFound')
        },
      },
    })
    const [item] = await within(sheet).findAllByRole('listitem')
    if (!item) throw new Error('항목 없음')
    const menu = await itemMenu(user, item)
    await user.click(
      within(menu).getByRole('menuitem', { name: ko.comments.edit }),
    )
    const before = gets
    await user.type(box(sheet), '!')
    await user.click(
      within(sheet).getByRole('button', { name: ko.common.save }),
    )
    expect(
      await within(sheet).findByText(ko.errors.comment.notFound),
    ).toBeInTheDocument()
    expect(await within(sheet).findByText(ko.comments.empty)).toBeVisible()
    expect(gets).toBeGreaterThan(before)
    expect(
      within(sheet).queryByText(ko.comments.editing),
    ).not.toBeInTheDocument()
    expect(box(sheet)).toHaveValue('')
  })

  it('delete_gone_comment_refreshes', async () => {
    let items = [commentFixture('c1', { author_id: GRANDMA })]
    const { user, sheet } = await openSheet({
      comments: () => items,
      extra: {
        'DELETE /api/comments/c1': () => {
          items = []
          return apiError(404, 'comment.notFound')
        },
      },
    })
    const [item] = await within(sheet).findAllByRole('listitem')
    if (!item) throw new Error('항목 없음')
    const menu = await itemMenu(user, item)
    await user.click(
      within(menu).getByRole('menuitem', { name: ko.comments.delete }),
    )
    const confirm = await screen.findByRole('dialog', {
      name: ko.comments.deleteTitle,
    })
    await user.click(
      within(confirm).getByRole('button', { name: ko.comments.delete }),
    )
    expect(
      await within(sheet).findByText(ko.errors.comment.notFound),
    ).toBeInTheDocument()
    expect(await within(sheet).findByText(ko.comments.empty)).toBeVisible()
    expect(
      screen.queryByRole('dialog', { name: ko.comments.deleteTitle }),
    ).not.toBeInTheDocument()
  })

  it('unknown_author_name', async () => {
    const { sheet } = await openSheet({
      users: [userFixture('guardian')],
      comments: () => [commentFixture('c1', { author_id: GRANDMA })],
    })
    const [item] = await within(sheet).findAllByRole('listitem')
    expect(item).toHaveTextContent(ko.comments.unknownUser)
  })

  it('escape_keeps_sheet_with_draft', async () => {
    const { user, sheet } = await openSheet({ comments: () => [] })
    await user.type(box(sheet), '안녕')
    await user.keyboard('{Escape}')
    expect(sheet).toBeInTheDocument()
    expect(box(sheet)).toHaveValue('안녕')

    await user.clear(box(sheet))
    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(sheet).not.toBeInTheDocument()
    })
  })

  it('offline_blocks_input', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const { sheet } = await openSheet({
      comments: () => [commentFixture('c1')],
    })
    expect(await within(sheet).findByText('예뻐요')).toBeInTheDocument()
    expect(within(sheet).getByText(ko.comments.offline)).toBeInTheDocument()
    expect(within(sheet).queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('post_after_trash_keeps_draft', async () => {
    const { user, sheet } = await openSheet({
      comments: () => [],
      extra: {
        'POST /api/assets/a/comments': () => apiError(404, 'asset.notFound'),
      },
    })
    await user.type(box(sheet), '안녕')
    await user.click(postButton(sheet))
    expect(
      await within(sheet).findByText(ko.errors.asset.notFound),
    ).toBeInTheDocument()
    expect(box(sheet)).toHaveValue('안녕')
  })

  it('mention_picker_keyboard', async () => {
    let posted: unknown
    const { user, sheet } = await openSheet({
      users: family('guardian', [
        { ...userFixture('family'), id: MOM, display_name: '엄마' },
        { ...userFixture('family'), id: MOM2, display_name: '엄마2' },
        {
          ...userFixture('family'),
          id: '00000000-0000-4000-8000-00000000000c',
          display_name: '엄마3',
          disabled_at: '2024-01-01T00:00:00Z',
        },
      ]),
      comments: () => [],
      extra: {
        'POST /api/assets/a/comments': async (req) => {
          posted = await req.json()
          return json(201, commentFixture('c1'))
        },
      },
    })
    const input = box(sheet)
    await user.type(input, '@엄')
    const listbox = within(sheet).getByRole('listbox')
    const options = within(listbox).getAllByRole('option')
    // 정지된 사용자 제외.
    expect(options.map((o) => o.textContent)).toEqual(['엄마', '엄마2'])
    expect(input).toHaveAttribute('aria-activedescendant', options[0]?.id)

    await user.keyboard('{ArrowDown}')
    expect(input).toHaveAttribute('aria-activedescendant', options[1]?.id)
    expect(options[1]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Enter}')
    expect(input).toHaveValue('@엄마2 ')
    expect(within(sheet).queryByRole('listbox')).not.toBeInTheDocument()

    // Esc 는 목록만 닫음. 시트 유지.
    await user.type(input, '안녕 @엄')
    expect(within(sheet).getByRole('listbox')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(within(sheet).queryByRole('listbox')).not.toBeInTheDocument()
    expect(input).not.toHaveAttribute('aria-activedescendant')
    expect(sheet).toBeInTheDocument()

    await user.click(postButton(sheet))
    await waitFor(() => {
      expect(posted).toEqual({ body: `<@${MOM2}> 안녕 @엄` })
    })
  })

  it('story_target_endpoints', async () => {
    let items: StoryComment[] = [
      storyCommentFixture('c1', { body: '첫 댓글' }),
      storyCommentFixture('c2', { author_id: GRANDMA, body: '할머니 댓글' }),
    ]
    const sent: string[] = []
    mockFetch({
      'GET /api/auth/me': () => json(200, { user: userFixture('guardian') }),
      'GET /api/users': () => json(200, { users: family('guardian') }),
      'GET /api/stories/s/likes': () =>
        json(200, [{ user_id: GRANDMA, created_at: '2024-05-10T03:00:00Z' }]),
      'GET /api/stories/s/comments': () =>
        json(200, { items, next_cursor: null }),
      'POST /api/stories/s/comments': async (req) => {
        sent.push(`POST ${JSON.stringify(await req.json())}`)
        const c = storyCommentFixture('c3', { body: '새 댓글' })
        items = [...items, c]
        return json(201, c)
      },
      'PATCH /api/story-comments/c1': async (req) => {
        sent.push(`PATCH ${JSON.stringify(await req.json())}`)
        const c = storyCommentFixture('c1', {
          body: '고친 댓글',
          edited_at: '2024-05-10T04:00:00Z',
        })
        items = items.map((x) => (x.id === 'c1' ? c : x))
        return json(200, c)
      },
      'DELETE /api/story-comments/c2': () => {
        sent.push('DELETE')
        items = items.filter((x) => x.id !== 'c2')
        return json(204, null)
      },
    })
    const qc = createTestQueryClient()
    qc.setQueryData(storyKey('s'), storyFixture('s'))
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={qc}>
        <CommentSheet
          target={{ kind: 'story', id: 's' }}
          open
          onOpenChange={() => {}}
          count={2}
          likeCount={1}
        />
      </QueryClientProvider>,
    )
    const sheet = await screen.findByRole('dialog', { name: /^댓글/ })
    expect(await within(sheet).findByText('첫 댓글')).toBeInTheDocument()
    // 할머니 댓글 작성자 + 하트 누른 사람 요약(이야기 경로).
    await waitFor(() => {
      expect(within(sheet).getAllByText('할머니')).toHaveLength(2)
    })

    await user.type(box(sheet), '새 댓글')
    await user.click(postButton(sheet))
    expect(await within(sheet).findByText('새 댓글')).toBeInTheDocument()
    expect(qc.getQueryState(storyKey('s'))?.isInvalidated).toBe(true)

    const [mine, others] = within(sheet).getAllByRole('listitem') as [
      HTMLElement,
      HTMLElement,
    ]
    let menu = await itemMenu(user, mine)
    await user.click(
      within(menu).getByRole('menuitem', { name: ko.comments.edit }),
    )
    await user.clear(box(sheet))
    await user.type(box(sheet), '고친 댓글')
    await user.click(
      within(sheet).getByRole('button', { name: ko.common.save }),
    )
    expect(await within(sheet).findByText('고친 댓글')).toBeInTheDocument()

    menu = await itemMenu(user, others)
    await user.click(
      within(menu).getByRole('menuitem', { name: ko.comments.delete }),
    )
    const confirm = await screen.findByRole('dialog', {
      name: ko.comments.deleteTitle,
    })
    await user.click(
      within(confirm).getByRole('button', { name: ko.comments.delete }),
    )
    await waitFor(() => {
      expect(within(sheet).queryByText('할머니 댓글')).not.toBeInTheDocument()
    })
    expect(sent).toEqual([
      'POST {"body":"새 댓글"}',
      'PATCH {"body":"고친 댓글"}',
      'DELETE',
    ])
  })

  it('relative_time_steps', () => {
    const t = i18next.t.bind(i18next)
    const now = new Date('2026-11-12T12:00:00Z')
    const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()
    expect(relativeTime(ago(30_000), now, 'ko', t)).toBe('방금')
    expect(relativeTime(ago(5 * 60_000), now, 'ko', t)).toBe('5분 전')
    expect(relativeTime(ago(3 * 3_600_000), now, 'ko', t)).toBe('3시간 전')
    expect(relativeTime('2026-11-09T12:00:00Z', now, 'ko', t)).toBe('11월 9일')
    expect(relativeTime('2025-11-09T12:00:00Z', now, 'ko', t)).toBe(
      '2025년 11월 9일',
    )
  })
})
