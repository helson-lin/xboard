import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject, TouchEvent, WheelEvent } from 'react'
import {
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Heart,
  MessageCircle,
  PanelRightClose,
  PanelRightOpen,
  Play,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
  Minus,
  Plus,
  RotateCcw,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { VideoPlayer } from '@/components/board/VideoPlayer'
import { ZoomableImage, type ImageZoomHandle } from '@/components/board/ZoomableImage'
import { PostTagEditor } from '@/components/board/PostTagEditor'
import type { MediaItem, Post, Tag } from '@/lib/types'
import {
  formatCount,
  formatDate,
  formatDuration,
  formatSize,
  hexToRgba,
  tagInk,
} from '@/lib/format'
import { cn } from '@/lib/utils'
import { triggerDownload, triggerPublicDownload } from '@/lib/api'

function sortMedia(post: Post): MediaItem[] {
  return post.media?.length
    ? [...post.media].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    : [...(post.videos ?? []), ...(post.images ?? [])]
}

function MediaView({ item, poster, zoomRef, onScaleChange }: {
  item: MediaItem
  poster?: string | null
  zoomRef: RefObject<ImageZoomHandle | null>
  onScaleChange: (scale: number) => void
}) {
  if (String(item.kind) === 'video') {
    return <VideoPlayer item={item} poster={poster} />
  }
  return <ZoomableImage key={item.url} src={item.url} ref={zoomRef} onScaleChange={onScaleChange} />
}

export function PostLightbox({
  posts,
  index,
  open,
  onClose,
  onNavigate,
  onDelete,
  onRetag,
  onSaveNote,
  onSaveTags,
  tags = [],
  tagColor,
  busy,
  readOnly,
}: {
  posts: Post[]
  index: number
  open: boolean
  onClose: () => void
  onNavigate: (index: number) => void
  onDelete?: (post: Post) => void
  onRetag?: (post: Post) => void
  onSaveNote?: (post: Post, note: string) => void
  onSaveTags?: (post: Post, tags: string[]) => Promise<void>
  tags?: Tag[]
  tagColor: (name: string) => string | undefined
  busy: boolean
  readOnly?: boolean
}) {
  const post = index >= 0 && index < posts.length ? posts[index] : null
  const [note, setNote] = useState('')
  const [mediaIndex, setMediaIndex] = useState(0)
  const [collapsed, setCollapsed] = useState(false)
  const [direction, setDirection] = useState(0)
  const zoomRef = useRef<ImageZoomHandle>(null)
  const [zoomScale, setZoomScale] = useState(1)
  const touchRef = useRef<{ x: number; y: number; onMedia: boolean } | null>(null)
  const lastWheelNav = useRef(0)

  const media = useMemo(() => (post ? sortMedia(post) : []), [post])

  useEffect(() => {
    setNote(post?.note ?? '')
    setMediaIndex(0)
  }, [post?.id, post?.note])

  useEffect(() => {
    if (open) setCollapsed(false)
  }, [open])

  const prev = useCallback(() => {
    if (index > 0) {
      setDirection(-1)
      onNavigate(index - 1)
    }
  }, [index, onNavigate])

  const next = useCallback(() => {
    if (index >= 0 && index < posts.length - 1) {
      setDirection(1)
      onNavigate(index + 1)
    }
  }, [index, posts.length, onNavigate])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') prev()
      else if (e.key === 'ArrowRight') next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, prev, next, onClose])

  const dirty = post ? note !== (post.note ?? '') : false
  const currentMedia = media.length
    ? media[Math.min(mediaIndex, media.length - 1)]
    : null

  const handleTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    const t = e.touches[0]
    if (!t) return
    const el = e.target as HTMLElement | null
    touchRef.current = {
      x: t.clientX,
      y: t.clientY,
      // 在视频控件(进度条等)上滑动时不切换推文
      onMedia: !!el?.closest('video, [data-zoomable-image]'),
    }
  }

  const handleTouchEnd = (e: TouchEvent<HTMLDivElement>) => {
    const start = touchRef.current
    touchRef.current = null
    if (!start || start.onMedia) return
    const t = e.changedTouches[0]
    if (!t) return
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    // 需要明显的水平滑动(距离 + 方向占优)
    if (Math.abs(dx) < 64) return
    if (Math.abs(dx) < Math.abs(dy) * 1.25) return
    if (dx > 0) prev()
    else next()
  }

  const handleWheel = (e: WheelEvent<HTMLDivElement>) => {
    // 触控板横向滑动
    if (Math.abs(e.deltaX) < Math.abs(e.deltaY)) return
    if (Math.abs(e.deltaX) < 40) return
    const now = Date.now()
    if (now - lastWheelNav.current < 400) return
    lastWheelNav.current = now
    if (e.deltaX > 0) next()
    else prev()
  }

  return (
    <AnimatePresence>
      {open && post ? (
        <motion.div
          key="post-lightbox"
          className="fixed inset-0 z-[60] flex flex-col bg-background text-foreground"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          role="dialog"
          aria-modal="true"
        >
          {/* Zoom on the left; detail actions on the right. */}
          <div className="flex h-14 shrink-0 items-center justify-start gap-1 px-3 sm:px-4" role="toolbar" aria-label="详情工具栏">
            {currentMedia && String(currentMedia.kind) !== 'video' ? (
              <>
                <Button variant="ghost" size="icon" aria-label="缩小图片" title="缩小图片"
                  disabled={zoomScale <= 1} onClick={() => zoomRef.current?.zoomOut()}><Minus /></Button>
                <span className="min-w-12 text-center text-xs tabular-nums" aria-live="polite">{Math.round(zoomScale * 100)}%</span>
                <Button variant="ghost" size="icon" aria-label="放大图片" title="放大图片"
                  disabled={zoomScale >= 8} onClick={() => zoomRef.current?.zoomIn()}><Plus /></Button>
                <Button variant="ghost" size="icon" aria-label="复位图片" title="复位图片"
                  onClick={() => zoomRef.current?.reset()}><RotateCcw /></Button>
              </>
            ) : null}
            <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setCollapsed((v) => !v)}
              aria-label={collapsed ? '展开详情' : '收起详情'}
            >
              {collapsed ? <PanelRightOpen /> : <PanelRightClose />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => window.open(post.url, '_blank')}
              aria-label="在原站打开"
            >
              <ExternalLink />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() =>
                readOnly
                  ? triggerPublicDownload(post.id)
                  : triggerDownload(post.id)
              }
              aria-label="下载素材"
            >
              <Download />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              aria-label="关闭"
            >
              <X />
            </Button>
            </div>
          </div>

          {/* Body */}
          <div className="relative flex min-h-0 flex-1 flex-col md:flex-row">
            {/* Media pane */}
            <div
              className={cn(
                'relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4 sm:p-8',
                !collapsed && 'md:pr-[26rem]',
              )}
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
              onWheel={handleWheel}
            >
              <motion.div
                key={post.id}
                initial={{ opacity: 0, x: direction * 48 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="flex h-full w-full items-center justify-center"
              >
                {currentMedia ? (
                  <MediaView item={currentMedia} poster={post.poster_url} zoomRef={zoomRef} onScaleChange={setZoomScale} />
                ) : (
                  <p className="text-sm text-muted-foreground">无媒体</p>
                )}
              </motion.div>

              {/* Prev / next */}
              <button
                onClick={prev}
                disabled={index <= 0}
                aria-label="上一条推文"
                className="absolute left-2 top-1/2 z-20 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white/90 shadow-lg backdrop-blur transition hover:bg-black/70 disabled:pointer-events-none disabled:opacity-30 sm:left-4"
              >
                <ChevronLeft className="size-6" />
              </button>
              <button
                onClick={next}
                disabled={index >= posts.length - 1}
                aria-label="下一条推文"
                className={cn(
                  'absolute right-2 top-1/2 z-20 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white/90 shadow-lg backdrop-blur transition-[right,background-color,opacity] hover:bg-black/70 disabled:pointer-events-none disabled:opacity-30 sm:right-4',
                  !collapsed && 'md:right-[25rem]',
                )}
              >
                <ChevronRight className="size-6" />
              </button>

              {/* Thumbnail strip for multi-media posts */}
              {media.length > 1 ? (
                <div
                  className={cn(
                    'absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 gap-2.5 rounded-full bg-black/50 p-2 backdrop-blur transition-[left]',
                    !collapsed && 'md:left-[calc((100%-24rem)/2)]',
                  )}
                >
                  {media.map((m, i) => (
                    <button
                      key={m.id ?? `${m.url}-${i}`}
                      onClick={() => setMediaIndex(i)}
                      aria-label={`查看第 ${i + 1} 个媒体`}
                      className={cn(
                        'size-9 overflow-hidden rounded-md ring-2 transition',
                        i === mediaIndex
                          ? 'ring-white'
                          : 'opacity-60 ring-transparent hover:opacity-100',
                      )}
                    >
                      {String(m.kind) === 'video' ? (
                        <span className="flex size-full items-center justify-center bg-neutral-800">
                          <Play className="size-3 text-white" />
                        </span>
                      ) : (
                        <img src={m.url} alt="" className="size-full object-cover" />
                      )}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {/* Collapsible detail card */}
            <AnimatePresence>
              {!collapsed ? (
                <motion.div
                  key="post-detail"
                  className="flex max-h-[55%] w-full shrink-0 flex-col overflow-y-auto border-t border-border/40 bg-background md:absolute md:inset-y-4 md:right-4 md:z-30 md:max-h-none md:w-[24rem] md:rounded-xl md:border md:border-border/60 md:bg-background/95 md:shadow-2xl md:backdrop-blur-xl"
                  initial={{ opacity: 0, x: 24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 24 }}
                  transition={{ duration: 0.18 }}
                >
                  <div className="flex items-start gap-3 p-4 pb-3">
                    <Avatar className="size-10">
                      <AvatarImage src={post.author_avatar ?? undefined} alt="" />
                      <AvatarFallback>
                        {(post.author_name || post.author_handle || '?')
                          .replace(/^@/, '')
                          .slice(0, 2)
                          .toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <span className="truncate text-sm font-semibold">
                          {post.author_name || post.author_handle || '未知作者'}
                        </span>
                        {post.author_verified ? (
                          <BadgeCheck className="size-4 shrink-0 text-primary" />
                        ) : null}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {post.author_handle
                          ? `@${post.author_handle.replace(/^@/, '')}`
                          : '—'}
                        {post.created_at ? ` · ${formatDate(post.created_at)}` : ''}
                      </div>
                    </div>
                  </div>

                  {!readOnly && onSaveTags && <div className="px-4 pb-3">
                    <PostTagEditor key={post.id} post={post} tags={tags} onSave={onSaveTags} />
                  </div>}

                  <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3">
                    {post.tags?.length ? (
                      post.tags.map((t) => {
                        const c = tagColor(t)
                        return (
                          <Badge
                            key={t}
                            variant="outline"
                            className={c ? 'tag-ink' : undefined}
                            style={
                              c
                                ? { ...tagInk(c), borderColor: hexToRgba(c, 0.5) }
                                : undefined
                            }
                          >
                            {t}
                          </Badge>
                        )
                      })
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">
                        未归类
                      </Badge>
                    )}
                    <Badge variant="secondary">
                      {post.media_kind === 'video'
                        ? '视频'
                        : post.media_kind === 'image'
                          ? '图片'
                          : '文字'}
                    </Badge>
                    {post.status !== 'ready' ? (
                      <Badge
                        variant={post.status === 'failed' ? 'destructive' : 'secondary'}
                      >
                        {post.status === 'failed' ? '失败' : '处理中'}
                      </Badge>
                    ) : null}
                  </div>

                  <div className="flex-1 space-y-4 px-4 pb-4">
                    {post.text ? (
                      <p className="whitespace-pre-wrap text-sm leading-relaxed">
                        {post.text}
                      </p>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Heart className="size-3.5" />
                        {formatCount(post.favorite_count ?? 0)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <MessageCircle className="size-3.5" />
                        {formatCount(post.reply_count ?? 0)}
                      </span>
                      {post.duration ? <span>{formatDuration(post.duration)}</span> : null}
                      {post.total_size || post.size_bytes ? (
                        <span>
                          {formatSize(post.total_size ?? post.size_bytes ?? 0)}
                        </span>
                      ) : null}
                      {post.added_at ? (
                        <span>入库 {formatDate(post.added_at)}</span>
                      ) : null}
                    </div>

                    {post.error ? (
                      <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                        {post.error}
                      </div>
                    ) : null}

                    {readOnly ? (
                      post.note ? (
                        <>
                          <Separator />
                          <div className="space-y-2">
                            <div className="text-xs font-medium text-muted-foreground">
                              备注
                            </div>
                            <p className="whitespace-pre-wrap text-sm">{post.note}</p>
                          </div>
                        </>
                      ) : null
                    ) : (
                      <>
                        <Separator />
                        <div className="space-y-2">
                          <div className="text-xs font-medium text-muted-foreground">
                            备注
                          </div>
                          <Textarea
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder="给这条推文加个备注…"
                            rows={3}
                          />
                        </div>
                      </>
                    )}
                  </div>

                  {!readOnly && (
                    <div className="sticky bottom-0 flex flex-wrap gap-2 border-t border-border/60 bg-background/95 p-4 backdrop-blur">
                      <Button
                        variant="outline"
                        className="gap-1.5"
                        onClick={() => onRetag?.(post)}
                        disabled={busy}
                      >
                        <Sparkles />
                        重新归类
                      </Button>
                      <Button
                        className="gap-1.5"
                        onClick={() => onSaveNote?.(post, note)}
                        disabled={!dirty || busy}
                      >
                        <RefreshCw />
                        保存备注
                      </Button>
                      <Button
                        variant="destructive"
                        className="gap-1.5 md:ml-auto"
                        onClick={() => onDelete?.(post)}
                        disabled={busy}
                      >
                        <Trash2 />
                        删除
                      </Button>
                    </div>
                  )}
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
