import { describe, expect, it } from 'vitest'
import type { User } from '@/api/types'
import { userFixture } from '@/test/fixtures'
import { mentionQuery, toBody, toEditable, toSegments } from './mentions'

const MOM = '00000000-0000-4000-8000-00000000000a'
const MOM2 = '00000000-0000-4000-8000-00000000000b'
const GONE = '00000000-0000-4000-8000-0000000000ff'

const users: User[] = [
  { ...userFixture('family'), id: MOM, display_name: '엄마' },
  { ...userFixture('family'), id: MOM2, display_name: '엄마2' },
]

describe('mentions', () => {
  it('segments_render_current_names', () => {
    expect(toSegments(`<@${MOM}> 안녕\n<@${MOM2}>!`, users, '?')).toEqual([
      { kind: 'mention', userId: MOM, name: '엄마' },
      { kind: 'text', text: ' 안녕\n' },
      { kind: 'mention', userId: MOM2, name: '엄마2' },
      { kind: 'text', text: '!' },
    ])
    // 서버 규칙 밖(대문자, 짧은 id, 닫는 괄호 없음)은 평문.
    const plain = `<@${MOM.toUpperCase()}> <@abc> <@${MOM}`
    expect(toSegments(plain, users, '?')).toEqual([
      { kind: 'text', text: plain },
    ])
    // 앞의 깨진 토큰 바로 뒤 토큰은 인식.
    expect(toSegments(`<@<@${MOM}>`, users, '?')).toEqual([
      { kind: 'text', text: '<@' },
      { kind: 'mention', userId: MOM, name: '엄마' },
    ])
  })

  it('unknown_mention_name', () => {
    expect(toSegments(`<@${GONE}>님`, users, '알 수 없음')).toEqual([
      { kind: 'mention', userId: GONE, name: '알 수 없음' },
      { kind: 'text', text: '님' },
    ])
  })

  it('mention_prefix_names', () => {
    const picked = [
      { userId: MOM, name: '엄마' },
      { userId: MOM2, name: '엄마2' },
    ]
    const expected = `<@${MOM2}> <@${MOM}> 고마워`
    expect(toBody('@엄마2 @엄마 고마워', picked)).toBe(expected)
    expect(toBody('@엄마2 @엄마 고마워', [...picked].reverse())).toBe(expected)
  })

  it('editable_roundtrip', () => {
    const body = `<@${MOM2}>와 <@${MOM}> 둘 다, <@${GONE}> 도`
    const editable = toEditable(body, users)
    expect(editable.text).toBe(`@엄마2와 @엄마 둘 다, <@${GONE}> 도`)
    expect(editable.picked).toEqual([
      { userId: MOM2, name: '엄마2' },
      { userId: MOM, name: '엄마' },
    ])
    expect(toBody(editable.text, editable.picked)).toBe(body)
  })

  it('removed_mention_stays_text', () => {
    const picked = [{ userId: MOM, name: '엄마' }]
    expect(toBody('@엄 안녕', picked)).toBe('@엄 안녕')
    expect(toBody('엄마 안녕', picked)).toBe('엄마 안녕')
  })

  it('mention_query_at_caret', () => {
    expect(mentionQuery('안녕 @엄', 5)).toEqual({ start: 3, query: '엄' })
    expect(mentionQuery('a@', 2)).toEqual({ start: 1, query: '' })
    // 커서가 이름 중간이면 커서 앞까지.
    expect(mentionQuery('@엄마 안녕', 2)).toEqual({ start: 0, query: '엄' })
    // 공백을 넘으면 끝.
    expect(mentionQuery('@엄마 안녕', 6)).toBeNull()
    expect(mentionQuery('@엄마\n', 4)).toBeNull()
    expect(mentionQuery('안녕', 2)).toBeNull()
  })
})
