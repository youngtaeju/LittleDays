import type { User } from '@/api/types'

// 서버 규칙과 동일. `<@` + 소문자 하이픈 UUID 36자 + `>`. 그 밖은 평문.
const TOKEN =
  /<@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>/g

export type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; userId: string; name: string }

// 입력칸의 `@이름` 과 사용자 id 대응.
export type Picked = { userId: string; name: string }

function nameOf(users: User[], id: string): string | undefined {
  return users.find((u) => u.id === id)?.display_name
}

// 본문 → 화면 조각. 멘션은 현재 표시 이름, 모르는 id 는 unknown.
export function toSegments(
  body: string,
  users: User[],
  unknown: string,
): Segment[] {
  const out: Segment[] = []
  let last = 0
  for (const m of body.matchAll(TOKEN)) {
    const id = m[1] ?? ''
    if (m.index > last)
      out.push({ kind: 'text', text: body.slice(last, m.index) })
    out.push({
      kind: 'mention',
      userId: id,
      name: nameOf(users, id) ?? unknown,
    })
    last = m.index + m[0].length
  }
  if (last < body.length) out.push({ kind: 'text', text: body.slice(last) })
  return out
}

// 본문 → 입력칸 글자. 모르는 id 의 토큰은 그대로 남겨 되돌릴 때 같은 본문.
export function toEditable(
  body: string,
  users: User[],
): { text: string; picked: Picked[] } {
  const picked: Picked[] = []
  const text = body.replace(TOKEN, (token, id: string) => {
    const name = nameOf(users, id)
    if (name === undefined) return token
    if (!picked.some((p) => p.userId === id)) picked.push({ userId: id, name })
    return `@${name}`
  })
  return { text, picked }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 입력칸 글자 → 본문. 남아 있는 `@이름` 만 토큰. 긴 이름 먼저 맞춰 "엄마2" 가 "엄마" 로 잘리지 않게.
// 이름 뒤 경계 검사 없음(의도). "@엄마가" 처럼 조사가 바로 붙는 한국어 때문.
// 표시 이름이 같은 두 사용자는 구별 불가, 나중에 고른 쪽 id.
export function toBody(text: string, picked: Picked[]): string {
  if (picked.length === 0) return text
  const byName = new Map(picked.map((p) => [p.name, p.userId]))
  const names = [...byName.keys()].sort((a, b) => b.length - a.length)
  const pattern = new RegExp(`@(${names.map(escapeRegExp).join('|')})`, 'g')
  return text.replace(pattern, (whole, name: string) => {
    const id = byName.get(name)
    return id ? `<@${id}>` : whole
  })
}

// 커서 바로 앞의 `@` 부터 커서까지. 사이에 공백이 있으면 없음.
export function mentionQuery(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const start = before.lastIndexOf('@')
  if (start < 0) return null
  const query = before.slice(start + 1)
  if (/\s/.test(query)) return null
  return { start, query }
}
