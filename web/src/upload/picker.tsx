import { useQueryClient } from '@tanstack/react-query'
import { createContext, use, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { babiesQuery } from '@/timeline/useBabies'
import { ACCEPTED_FILE_TYPES } from './useUploadStore'

interface UploadPicker {
  open: () => void
}

const PickerContext = createContext<UploadPicker | null>(null)

// 셸 전체 공용 숨은 파일 입력 하나. (+)·사이드바·빈 화면 버튼이 같은 선택창 사용.
export function UploadPickerProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [picker] = useState<UploadPicker>(() => ({
    open: () => inputRef.current?.click(),
  }))

  // 아기 1명이면 자동 태그, 여럿이면 태그 없음. 아기 조회 실패도 태그 없음.
  async function onPick(files: File[]) {
    try {
      const [{ getUploader }, babies] = await Promise.all([
        // Uppy 는 첫 선택 때 지연 로딩.
        import('./uploader'),
        // 캐시 있으면 그대로(화면에 보이는 아기 기준).
        qc.query({ ...babiesQuery, staleTime: 'static' }).catch(() => []),
      ])
      getUploader(qc).add(
        files,
        babies.length === 1 ? babies.map((b) => b.id) : [],
      )
    } catch {
      toast.error(t('errors.unknown'))
    }
  }

  return (
    <PickerContext value={picker}>
      {children}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED_FILE_TYPES.join(',')}
        className="hidden"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const files = [...(e.currentTarget.files ?? [])]
          // 같은 파일 다시 선택(이어 올리기·다시 올리기) 허용.
          e.currentTarget.value = ''
          if (files.length > 0) void onPick(files)
        }}
      />
    </PickerContext>
  )
}

export function useUploadPicker(): UploadPicker {
  const picker = use(PickerContext)
  if (!picker) throw new Error('UploadPickerProvider 밖에서 사용')
  return picker
}
