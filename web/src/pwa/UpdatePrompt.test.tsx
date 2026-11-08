import { act, fireEvent, render, screen } from '@testing-library/react'
import type { RegisterSWOptions } from 'virtual:pwa-register/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Toaster } from '@/components/ui/sonner'
import { initI18n } from '@/i18n'
import ko from '@/locales/ko.json'
import { UpdatePrompt } from './UpdatePrompt'

const sw = vi.hoisted(() => ({
  needRefresh: false,
  updateServiceWorker: vi.fn<(reload?: boolean) => Promise<void>>(),
  options: undefined as RegisterSWOptions | undefined,
}))

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: (options?: RegisterSWOptions) => {
    sw.options = options
    return {
      needRefresh: [sw.needRefresh, vi.fn()],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: sw.updateServiceWorker,
    }
  },
}))

beforeEach(() => {
  initI18n('ko')
  sw.updateServiceWorker.mockReset().mockResolvedValue(undefined)
})

describe('UpdatePrompt', () => {
  it('no_toast_without_update', () => {
    sw.needRefresh = false
    render(
      <>
        <Toaster />
        <UpdatePrompt />
      </>,
    )
    expect(screen.queryByText(ko.pwa.updateAvailable)).not.toBeInTheDocument()
  })

  it('reload_activates_new_worker', async () => {
    sw.needRefresh = true
    render(
      <>
        <Toaster />
        <UpdatePrompt />
      </>,
    )
    await screen.findByText(ko.pwa.updateAvailable)
    // sonner 의 pointer capture 를 jsdom 이 미구현. click 이벤트만 전달.
    fireEvent.click(screen.getByRole('button', { name: ko.pwa.reload }))
    expect(sw.updateServiceWorker).toHaveBeenCalledOnce()
  })

  // 설치형 앱이 백그라운드에서 돌아올 때 새 버전 확인. 숨김 상태·언마운트 후에는 안 함.
  it('checks_update_when_visible', () => {
    sw.needRefresh = false
    const update = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    const visibility = vi.spyOn(document, 'visibilityState', 'get')
    const { unmount } = render(<UpdatePrompt />)
    act(() => {
      sw.options?.onRegisteredSW?.('/sw.js', {
        update,
      } as unknown as ServiceWorkerRegistration)
    })

    visibility.mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(update).not.toHaveBeenCalled()

    visibility.mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(update).toHaveBeenCalledOnce()

    unmount()
    document.dispatchEvent(new Event('visibilitychange'))
    expect(update).toHaveBeenCalledOnce()
    visibility.mockRestore()
  })
})
