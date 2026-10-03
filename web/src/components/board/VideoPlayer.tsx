import { useCallback, useEffect, useRef, useState } from 'react'
import { Maximize, Pause, Play, Volume2, VolumeX } from 'lucide-react'
import type { MediaItem } from '@/lib/types'
import { formatDuration } from '@/lib/format'

/**
 * Stable-size video player for the fullscreen lightbox.
 *
 * The default `<video controls>` element sizes itself only once metadata has
 * loaded, which makes it appear small and then jump to full size. Here the
 * container reserves its aspect ratio up front (from the recorded media
 * dimensions, falling back to 16:9), so layout is stable before the first
 * frame arrives. A poster renders immediately and custom controls take over.
 */
export function VideoPlayer({ item, poster }: { item: MediaItem; poster?: string | null }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const seekRef = useRef<HTMLDivElement>(null)

  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [seeking, setSeeking] = useState(false)

  const ar = item.width && item.height ? `${item.width} / ${item.height}` : '16 / 9'

  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) v.play().catch(() => {})
    else v.pause()
  }, [])

  const toggleMute = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    v.muted = !v.muted
    setMuted(v.muted)
  }, [])

  const seekTo = useCallback((ratio: number) => {
    const v = videoRef.current
    if (!v || !Number.isFinite(v.duration)) return
    const t = Math.max(0, Math.min(1, ratio)) * v.duration
    v.currentTime = t
    setCurrent(t)
  }, [])

  const ratioFromEvent = useCallback((clientX: number) => {
    const el = seekRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0) return 0
    return (clientX - rect.left) / rect.width
  }, [])

  const toggleFullscreen = useCallback(() => {
    const el = wrapRef.current
    if (!el) return
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    } else {
      el.requestFullscreen?.().catch(() => {})
    }
  }, [])

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onTime = () => setCurrent(v.currentTime)
    const onMeta = () => setDuration(v.duration || 0)
    const onProgress = () => {
      if (v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1))
    }
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onEnded = () => setPlaying(false)
    v.addEventListener('timeupdate', onTime)
    v.addEventListener('loadedmetadata', onMeta)
    v.addEventListener('progress', onProgress)
    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    v.addEventListener('ended', onEnded)
    return () => {
      v.removeEventListener('timeupdate', onTime)
      v.removeEventListener('loadedmetadata', onMeta)
      v.removeEventListener('progress', onProgress)
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onPause)
      v.removeEventListener('ended', onEnded)
    }
  }, [])

  useEffect(() => {
    setPlaying(false)
    setCurrent(0)
    setDuration(0)
    setBuffered(0)
  }, [item.url])

  const pct = duration ? (current / duration) * 100 : 0
  const bufPct = duration ? (buffered / duration) * 100 : 0

  return (
    <div
      ref={wrapRef}
      className="group relative max-h-full w-full max-w-full overflow-hidden rounded-lg bg-black shadow-2xl"
      style={{ aspectRatio: ar }}
    >
      <video
        ref={videoRef}
        src={item.url}
        poster={poster || undefined}
        playsInline
        preload="metadata"
        muted={muted}
        onClick={togglePlay}
        className="absolute inset-0 h-full w-full cursor-pointer object-contain"
      />

      {!playing ? (
        <button
          type="button"
          onClick={togglePlay}
          aria-label="播放"
          className="absolute left-1/2 top-1/2 flex size-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm transition hover:bg-white/25"
        >
          <Play className="size-8 fill-current" />
        </button>
      ) : null}

      <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 bg-gradient-to-t from-black/70 to-transparent px-3 pt-10 pb-2 text-white">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? '暂停' : '播放'}
          className="text-white/90 transition hover:text-white"
        >
          {playing ? <Pause className="size-5 fill-current" /> : <Play className="size-5 fill-current" />}
        </button>

        <span className="text-xs tabular-nums text-white/90">{formatDuration(current)}</span>

        <div
          ref={seekRef}
          className="relative h-1.5 flex-1 cursor-pointer rounded-full bg-white/25"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            setSeeking(true)
            seekTo(ratioFromEvent(e.clientX))
          }}
          onPointerMove={(e) => {
            if (seeking) seekTo(ratioFromEvent(e.clientX))
          }}
          onPointerUp={() => setSeeking(false)}
          onPointerCancel={() => setSeeking(false)}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-white/40"
            style={{ width: `${bufPct}%` }}
          />
          <div className="absolute inset-y-0 left-0 rounded-full bg-white" style={{ width: `${pct}%` }} />
        </div>

        <span className="text-xs tabular-nums text-white/90">
          {formatDuration(duration || item.duration)}
        </span>

        <button
          type="button"
          onClick={toggleMute}
          aria-label={muted ? '取消静音' : '静音'}
          className="text-white/90 transition hover:text-white"
        >
          {muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
        </button>

        <button
          type="button"
          onClick={toggleFullscreen}
          aria-label="全屏"
          className="text-white/90 transition hover:text-white"
        >
          <Maximize className="size-5" />
        </button>
      </div>
    </div>
  )
}