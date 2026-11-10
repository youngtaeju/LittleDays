import IconDone from '~icons/material-symbols/check-circle-outline-rounded'
import IconError from '~icons/material-symbols/error-outline-rounded'
import IconTrash from '~icons/material-symbols/delete-outline-rounded'
import IconResume from '~icons/material-symbols/upload-rounded'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { uploadStore, useUploadPill } from './useUploadStore'

// 원형 진행. 비율은 글자로도 표시라 장식.
function Ring({ percent }: { percent: number }) {
  const r = 8
  const c = 2 * Math.PI * r
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="size-5 -rotate-90">
      <circle
        cx="10"
        cy="10"
        r={r}
        fill="none"
        strokeWidth="3"
        className="stroke-muted"
      />
      <circle
        cx="10"
        cy="10"
        r={r}
        fill="none"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - percent / 100)}
        className="stroke-primary transition-[stroke-dashoffset] duration-200 ease-out motion-reduce:transition-none"
      />
    </svg>
  )
}

// 업로드 진행 알약. 휴대폰 탭 바 위 가운데, 데스크톱 오른쪽 아래. 누르면 업로드 목록.
export function UploadPill() {
  const { t } = useTranslation()
  const pill = useUploadPill()
  const kind = pill?.kind

  useEffect(() => {
    if (kind !== 'done') return
    const id = setTimeout(uploadStore.dismissRun, 3000)
    return () => {
      clearTimeout(id)
    }
  }, [kind])

  const text = !pill
    ? ''
    : pill.kind === 'progress'
      ? t('upload.pill.uploading', { count: pill.count })
      : t(`upload.pill.${pill.kind}`, { count: pill.count })
  return (
    <>
      {/* 진행률 변화마다 읽지 않도록 상태만 낭독. 내용 변경 낭독을 위해 항상 존재. */}
      <span role="status" className="sr-only">
        {text}
      </span>
      {pill && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-30 flex justify-center px-4 lg:inset-x-auto lg:right-6 lg:bottom-6 lg:px-0">
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={() => {
              // 완료·실패·휴지통 중복은 확인한 것으로 보고 숨김.
              if (pill.kind !== 'progress' && pill.kind !== 'resumable') {
                uploadStore.acknowledge()
              }
              uploadStore.openQueue()
            }}
            className={cn(
              'pointer-events-auto flex h-11 max-w-full items-center gap-2 rounded-full border border-border bg-background px-4 text-sm font-semibold shadow-lg tabular-nums',
              pill.kind === 'failed' && 'text-destructive',
            )}
          >
            {pill.kind === 'progress' && <Ring percent={pill.percent} />}
            {pill.kind === 'done' && (
              <IconDone aria-hidden className="size-5 text-accent-ink" />
            )}
            {pill.kind === 'failed' && (
              <IconError aria-hidden className="size-5" />
            )}
            {pill.kind === 'trash' && (
              <IconTrash aria-hidden className="size-5 text-accent-ink" />
            )}
            {pill.kind === 'resumable' && (
              <IconResume aria-hidden className="size-5" />
            )}
            <span className="truncate">
              {pill.kind === 'progress'
                ? `${text} · ${String(pill.percent)}%`
                : text}
            </span>
          </button>
        </div>
      )}
    </>
  )
}
