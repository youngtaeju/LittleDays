import { useId, type ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError } from '@/api/errors'
import { errorMessage } from '@/i18n'

export function Field({
  label,
  hint,
  error,
  ...props
}: {
  label: string
  hint?: string
  // 입력칸 아래 인라인 오류 문구.
  error?: string | null
} & ComponentProps<typeof Input>) {
  const id = useId()
  const hintId = useId()
  const errorId = useId()
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') ||
    undefined
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        {...props}
      />
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

// auth.disabled 는 로그인 응답으로도 오므로 숨기지 않음.
function isSessionRequired(e: unknown): boolean {
  return e instanceof ApiError && e.status === 401 && e.key === 'auth.required'
}

// 서버 에러 키를 번역해 표시. 클라이언트 검증 문구는 없음. 세션 만료는 전역 로그아웃이 처리하므로 숨김.
export function FormError({ error }: { error: unknown }) {
  const { t } = useTranslation()
  if (error == null || isSessionRequired(error)) return null
  return (
    <p role="alert" className="text-sm text-destructive">
      {errorMessage(t, error)}
    </p>
  )
}

export function formText(form: FormData, name: string): string {
  const v = form.get(name)
  return typeof v === 'string' ? v : ''
}
