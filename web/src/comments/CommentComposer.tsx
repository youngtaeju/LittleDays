import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { User } from '@/api/types'
import { FormError } from '@/components/Field'
import { Button } from '@/components/ui/button'
import { useBrowserOnline } from '@/pwa/OfflineBanner'
import type { ReactionTarget } from '@/reactions/useReactions'
import { toBody, toEditable } from './mentions'
import { MentionTextarea, type MentionValue } from './MentionTextarea'
import {
  isCommentGone,
  useCreateComment,
  useUpdateComment,
  type AnyComment,
} from './useComments'

// 서버와 같은 기준. 앞뒤 공백 제거 후 유니코드 문자 수.
const MAX_CHARS = 1000

// 아래 고정 입력칸. editing 이 있으면 그 댓글 고치기. 고치기 시작, 끝마다 key 로 새로 마운트.
export function CommentComposer({
  target,
  users,
  editing,
  notice,
  onEditDone,
  onGone,
  onPosted,
}: {
  target: ReactionTarget
  users: User[]
  editing: AnyComment | null
  // 입력칸 밖에서 난 오류(이미 없는 댓글). 이 입력칸의 오류가 우선.
  notice: unknown
  onEditDone: () => void
  onGone: (e: unknown) => void
  onPosted: () => void
}) {
  const { t } = useTranslation()
  const online = useBrowserOnline()
  const [value, setValue] = useState<MentionValue>(() =>
    editing ? toEditable(editing.body, users) : { text: '', picked: [] },
  )
  const create = useCreateComment(target)
  const update = useUpdateComment(target)
  const pending = create.isPending || update.isPending
  const error = editing ? update.error : create.error

  const body = toBody(value.text, value.picked).trim()
  const length = Array.from(body).length
  const over = length > MAX_CHARS

  function submit() {
    if (!body || over || pending || !online) return
    if (editing) {
      if (body === editing.body) {
        onEditDone()
        return
      }
      update.mutate(
        { id: editing.id, body },
        {
          onSuccess: onEditDone,
          onError: (e) => {
            if (isCommentGone(e)) onGone(e)
          },
        },
      )
      return
    }
    create.mutate(body, {
      onSuccess: () => {
        setValue({ text: '', picked: [] })
        onPosted()
      },
    })
  }

  return (
    <div className="relative shrink-0 border-t px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      {editing && (
        <div className="flex items-center gap-1 text-[13px] text-muted-foreground">
          <span>{t('comments.editing')}</span>
          <Button
            variant="ghost"
            className="h-11 px-2 text-[13px]"
            onClick={onEditDone}
          >
            {t('common.cancel')}
          </Button>
        </div>
      )}
      {online ? (
        <div className="flex items-end gap-2">
          <MentionTextarea
            users={users}
            value={value}
            onChange={setValue}
            onSubmit={submit}
            listClassName="inset-x-4 bottom-full mb-1"
            rows={1}
            autoFocus={editing !== null}
            aria-label={t('comments.input')}
            placeholder={t('comments.placeholder')}
            aria-invalid={over || undefined}
            className="max-h-[calc(4lh+1.25rem+2px)] min-h-11 resize-none overflow-y-auto py-2.5 text-[15px] leading-normal md:text-[15px]"
          />
          <Button
            className="h-11 shrink-0"
            disabled={!body || over || pending}
            onClick={submit}
          >
            {editing ? t('common.save') : t('comments.post')}
          </Button>
        </div>
      ) : (
        <p className="flex min-h-11 items-center justify-center text-[13px] text-muted-foreground">
          {t('comments.offline')}
        </p>
      )}
      {over && (
        <p className="pt-1 text-xs text-destructive tabular-nums">
          {t('comments.counter', { count: length })}
        </p>
      )}
      <FormError error={error ?? notice} />
    </div>
  )
}
