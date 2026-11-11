import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '@/i18n'
import ko from '@/locales/ko.json'
import { VideoPlayer } from './VideoPlayer'

const proto = HTMLMediaElement.prototype
let play: ReturnType<typeof vi.fn>
let pause: ReturnType<typeof vi.fn>

beforeEach(() => {
  initI18n('ko')
  play = vi.fn(() => Promise.resolve())
  pause = vi.fn()
  vi.spyOn(proto, 'play').mockImplementation(play as () => Promise<void>)
  vi.spyOn(proto, 'pause').mockImplementation(pause as () => void)
})
afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(HTMLVideoElement.prototype, 'webkitEnterFullscreen')
  Reflect.deleteProperty(Element.prototype, 'requestFullscreen')
})

function setup(onScrubbingChange = vi.fn()) {
  const view = render(
    <VideoPlayer
      durationHint={65}
      src="/v.mp4"
      poster="/p.webp"
      onScrubbingChange={onScrubbingChange}
    />,
  )
  const video = document.querySelector('video') as HTMLVideoElement
  return { ...view, video, onScrubbingChange }
}

function setDuration(video: HTMLVideoElement, d: number) {
  Object.defineProperty(video, 'duration', { value: d, configurable: true })
  fireEvent.durationChange(video)
}

describe('VideoPlayer', () => {
  it('no_autoplay', () => {
    const { video } = setup()
    expect(play).not.toHaveBeenCalled()
    expect(video.autoplay).toBe(false)
    expect(
      screen.getByRole('button', { name: ko.viewer.video.play }),
    ).toBeInTheDocument()
  })

  it('play_button_plays', async () => {
    const { video } = setup()
    await userEvent.click(
      screen.getByRole('button', { name: ko.viewer.video.play }),
    )
    expect(play).toHaveBeenCalledTimes(1)
    expect(video.muted).toBe(false)
    fireEvent.play(video)
    expect(
      screen.queryByRole('button', { name: ko.viewer.video.play }),
    ).toBeNull()
    expect(
      screen.getByRole('button', { name: ko.viewer.video.pause }),
    ).toBeInTheDocument()
  })

  it('range_seeks', () => {
    const { video } = setup()
    setDuration(video, 100)
    const range = screen.getByRole('slider', { name: ko.viewer.video.seek })
    expect(range).toHaveAttribute('max', '100')
    expect(range).toHaveAttribute('step', 'any')
    fireEvent.change(range, { target: { value: '42.5' } })
    expect(video.currentTime).toBe(42.5)
  })

  it('time_format', () => {
    const { video } = setup()
    setDuration(video, 3725)
    video.currentTime = 65.4
    fireEvent.timeUpdate(video)
    expect(screen.getByText('1:05')).toBeInTheDocument()
    expect(screen.getByText('1:02:05')).toBeInTheDocument()
    expect(screen.getByRole('slider')).toHaveAttribute(
      'aria-valuetext',
      '1:05 / 1:02:05',
    )
  })

  it('mute_toggle', async () => {
    const { video } = setup()
    await userEvent.click(
      screen.getByRole('button', { name: ko.viewer.video.mute }),
    )
    expect(video.muted).toBe(true)
    fireEvent.volumeChange(video)
    await userEvent.click(
      screen.getByRole('button', { name: ko.viewer.video.unmute }),
    )
    expect(video.muted).toBe(false)
  })

  it('fullscreen_prefers_webkit', async () => {
    const webkit = vi.fn()
    const request = vi.fn(() => Promise.resolve())
    Object.defineProperty(HTMLVideoElement.prototype, 'webkitEnterFullscreen', {
      value: webkit,
      configurable: true,
    })
    Element.prototype.requestFullscreen = request
    setup()
    await userEvent.click(
      screen.getByRole('button', { name: ko.viewer.video.fullscreen }),
    )
    expect(webkit).toHaveBeenCalledTimes(1)
    expect(request).not.toHaveBeenCalled()
  })

  it('fullscreen_falls_back_to_container', async () => {
    const request = vi.fn(() => Promise.resolve())
    Element.prototype.requestFullscreen = request
    const { video } = setup()
    await userEvent.click(
      screen.getByRole('button', { name: ko.viewer.video.fullscreen }),
    )
    expect(request).toHaveBeenCalledTimes(1)
    expect(video.parentElement).not.toBeNull()
  })

  it('fullscreen_hidden_without_api', () => {
    setup()
    expect(
      screen.queryByRole('button', { name: ko.viewer.video.fullscreen }),
    ).toBeNull()
  })

  it('scrubbing_disables_swipe', () => {
    const { onScrubbingChange } = setup()
    const range = screen.getByRole('slider')
    fireEvent.pointerDown(range)
    expect(onScrubbingChange).toHaveBeenLastCalledWith(true)
    fireEvent.pointerUp(range)
    expect(onScrubbingChange).toHaveBeenLastCalledWith(false)
    fireEvent.pointerDown(range)
    fireEvent.pointerCancel(range)
    expect(onScrubbingChange).toHaveBeenLastCalledWith(false)
  })

  it('pauses_on_unmount', () => {
    const { unmount, video } = setup()
    unmount()
    expect(pause).toHaveBeenCalled()
    expect(video.getAttribute('src')).toBeNull()
  })

  // 개발 모드 effect 재실행(mount → cleanup → mount) 후에도 src 유지.
  it('keeps_src_under_strict_mode', () => {
    render(
      <StrictMode>
        <VideoPlayer
          src="/v.mp4"
          poster="/p.webp"
          onScrubbingChange={vi.fn()}
        />
      </StrictMode>,
    )
    expect(document.querySelector('video')?.getAttribute('src')).toBe('/v.mp4')
  })

  it('space_toggles_play', () => {
    setup()
    const box = document.querySelector('video')?.parentElement as HTMLElement
    fireEvent.keyDown(box, { key: ' ' })
    expect(play).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(screen.getByRole('slider'), { key: ' ' })
    expect(play).toHaveBeenCalledTimes(1)
  })

  it('range_keys_seek_and_stop_propagation', () => {
    const { video } = setup()
    setDuration(video, 100)
    video.currentTime = 50
    const range = screen.getByRole('slider')
    const outer = vi.fn()
    window.addEventListener('keydown', outer)
    fireEvent.keyDown(range, { key: 'ArrowRight' })
    expect(video.currentTime).toBe(55)
    fireEvent.keyDown(range, { key: 'ArrowLeft' })
    fireEvent.keyDown(range, { key: 'ArrowLeft' })
    expect(video.currentTime).toBe(45)
    fireEvent.keyDown(range, { key: 'End' })
    expect(video.currentTime).toBe(100)
    fireEvent.keyDown(range, { key: 'Home' })
    expect(video.currentTime).toBe(0)
    window.removeEventListener('keydown', outer)
    expect(outer).not.toHaveBeenCalled()
  })

  it('modified_keys_ignored', () => {
    setup()
    const box = document.querySelector('video')?.parentElement as HTMLElement
    fireEvent.keyDown(box, { key: 'k', ctrlKey: true })
    fireEvent.keyDown(box, { key: ' ', metaKey: true })
    expect(play).not.toHaveBeenCalled()
  })

  it('duration_hint_and_error', () => {
    const { video } = setup()
    expect(screen.getByText('1:05')).toBeInTheDocument()
    fireEvent.error(video)
    expect(screen.getByText(ko.viewer.video.error)).toBeInTheDocument()
  })
})
