import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import IconFullscreen from '~icons/material-symbols/fullscreen-rounded'
import IconPause from '~icons/material-symbols/pause-rounded'
import IconPlay from '~icons/material-symbols/play-arrow-rounded'
import IconVolumeOff from '~icons/material-symbols/volume-off-rounded'
import IconVolumeUp from '~icons/material-symbols/volume-up-rounded'
import { cn } from '@/lib/utils'

// 방향키 한 번의 이동 초.
const KEY_SEEK_S = 5

type FullscreenVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void }

export function formatTime(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h > 0
    ? `${String(h)}:${String(m).padStart(2, '0')}:${s}`
    : `${String(m)}:${s}`
}

// 포스터 + 가운데 재생 버튼으로 시작(자동 재생 없음). 컨트롤 줄은 하단 막대 바로 위.
export function VideoPlayer({
  src,
  poster,
  label,
  durationHint = 0,
  controlsVisible = true,
  onScrubbingChange,
}: {
  src: string
  poster: string | undefined
  label?: string
  // 메타데이터 도착 전 표시용 길이(초).
  durationHint?: number
  controlsVisible?: boolean
  onScrubbingChange: (active: boolean) => void
}) {
  const { t } = useTranslation()
  const box = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const scrubbing = useRef(false)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(durationHint)
  const [failed, setFailed] = useState(false)
  const [fullscreenOn, setFullscreenOn] = useState(false)

  const scrubRef = useRef(onScrubbingChange)
  useEffect(() => {
    scrubRef.current = onScrubbingChange
  })
  // src 연결·해제를 effect 한 곳에서. JSX src 와 섞으면 StrictMode 재실행 후 src 유실.
  useEffect(() => {
    const el = video.current
    if (!el) return
    el.src = src
    return () => {
      // 넘김·언마운트 시 재생 정지, 버퍼·디코더 해제.
      el.pause()
      el.removeAttribute('src')
      el.load()
    }
  }, [src])
  // 끄는 도중 사라지면 뷰어 제스처 복구.
  useEffect(() => {
    return () => {
      if (scrubbing.current) scrubRef.current(false)
    }
  }, [])

  function scrub(active: boolean) {
    if (scrubbing.current === active) return
    scrubbing.current = active
    onScrubbingChange(active)
  }

  function togglePlay() {
    const v = video.current
    if (!v) return
    if (v.paused) {
      // 중단된 재생 시도는 오류 아님.
      v.play().catch(() => undefined)
    } else v.pause()
  }

  useEffect(() => {
    function sync() {
      setFullscreenOn(document.fullscreenElement === box.current)
    }
    document.addEventListener('fullscreenchange', sync)
    return () => {
      document.removeEventListener('fullscreenchange', sync)
    }
  }, [])

  function fullscreen() {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined)
      return
    }
    const v: FullscreenVideo | null = video.current
    if (v?.webkitEnterFullscreen) v.webkitEnterFullscreen()
    else void box.current?.requestFullscreen().catch(() => undefined)
  }

  function seekTo(seconds: number) {
    const v = video.current
    if (!v) return
    v.currentTime = Math.min(Math.max(seconds, 0), duration || 0)
    setTime(v.currentTime)
  }

  // 방향키는 ±5초(뷰어 사진 넘김과 분리). Home/End 는 처음/끝.
  function onRangeKeyDown(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const v = video.current
    if (!v) return
    if (e.key === 'ArrowLeft') seekTo(v.currentTime - KEY_SEEK_S)
    else if (e.key === 'ArrowRight') seekTo(v.currentTime + KEY_SEEK_S)
    else if (e.key === 'Home') seekTo(0)
    else if (e.key === 'End') seekTo(duration)
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  // 버튼·입력에서 온 Space 는 그쪽 기본 동작.
  function onKeyDown(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.target instanceof Element && e.target.closest('button, input')) return
    if (e.key === ' ' || e.key.toLowerCase() === 'k') {
      e.preventDefault()
      togglePlay()
    }
  }

  const canFullscreen =
    'webkitEnterFullscreen' in HTMLVideoElement.prototype ||
    typeof document.documentElement.requestFullscreen === 'function'
  const valueText = `${formatTime(time)} / ${formatTime(duration)}`
  const iconButton =
    'grid size-11 shrink-0 place-items-center rounded-full hover:bg-white/10 [&_svg]:size-6'

  return (
    <div
      ref={box}
      role="group"
      aria-label={label}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="absolute inset-0 bg-black outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-inset"
    >
      <video
        ref={video}
        playsInline
        aria-label={label}
        poster={poster}
        className="absolute inset-0 size-full"
        onError={() => {
          setFailed(true)
        }}
        onPlay={() => {
          setPlaying(true)
        }}
        onPause={() => {
          setPlaying(false)
        }}
        onEnded={() => {
          setPlaying(false)
        }}
        onTimeUpdate={(e) => {
          setTime(e.currentTarget.currentTime)
        }}
        onLoadedMetadata={(e) => {
          setDuration(e.currentTarget.duration)
        }}
        onDurationChange={(e) => {
          setDuration(e.currentTarget.duration)
        }}
        onVolumeChange={(e) => {
          setMuted(e.currentTarget.muted)
        }}
      />
      {failed && (
        <p className="absolute inset-x-0 top-1/2 z-10 -translate-y-1/2 px-8 text-center text-sm">
          {t('viewer.video.error')}
        </p>
      )}
      {!playing && !failed && (
        <button
          type="button"
          aria-label={t('viewer.video.play')}
          onClick={togglePlay}
          className="absolute top-1/2 left-1/2 grid size-16 -translate-1/2 place-items-center rounded-full bg-black/60 text-white [&_svg]:size-10"
        >
          <IconPlay aria-hidden />
        </button>
      )}
      <div
        data-no-gesture
        inert={!controlsVisible}
        className={cn(
          'absolute inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-10 flex items-center gap-1 bg-black/70 px-2 text-white transition-opacity duration-200',
          !controlsVisible && 'opacity-0',
        )}
      >
        {playing ? (
          <button
            type="button"
            aria-label={t('viewer.video.pause')}
            onClick={togglePlay}
            className={iconButton}
          >
            <IconPause aria-hidden />
          </button>
        ) : (
          <div className="size-11 shrink-0" />
        )}
        <span className="shrink-0 text-xs tabular-nums">
          {formatTime(time)}
        </span>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step="any"
          value={Math.min(time, duration || 0)}
          aria-label={t('viewer.video.seek')}
          aria-valuetext={valueText}
          onChange={(e) => {
            seekTo(Number(e.target.value))
          }}
          onKeyDown={onRangeKeyDown}
          onPointerDown={() => {
            scrub(true)
          }}
          onPointerUp={() => {
            scrub(false)
          }}
          onPointerCancel={() => {
            scrub(false)
          }}
          className="h-11 min-w-0 flex-1 accent-white"
        />
        <span className="shrink-0 text-xs tabular-nums">
          {formatTime(duration)}
        </span>
        <button
          type="button"
          aria-label={muted ? t('viewer.video.unmute') : t('viewer.video.mute')}
          onClick={() => {
            const v = video.current
            if (v) v.muted = !v.muted
          }}
          className={iconButton}
        >
          {muted ? <IconVolumeOff aria-hidden /> : <IconVolumeUp aria-hidden />}
        </button>
        {canFullscreen && (
          <button
            type="button"
            aria-label={
              fullscreenOn
                ? t('viewer.video.exitFullscreen')
                : t('viewer.video.fullscreen')
            }
            onClick={fullscreen}
            className={iconButton}
          >
            <IconFullscreen aria-hidden />
          </button>
        )}
      </div>
    </div>
  )
}
