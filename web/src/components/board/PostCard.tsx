import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Heart,
  MessageCircle,
  Play,
  Trash2,
  ExternalLink,
  AlertTriangle,
  StickyNote,
  BadgeCheck,
  MoreHorizontal,
  Download,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { MediaItem, Post } from '@/lib/types'
import { formatCount, formatDate, formatDuration, formatSize, hexToRgba } from '@/lib/format'
import { cn } from '@/lib/utils'
import { triggerDownload, triggerPublicDownload } from '@/lib/api'

interface PostCardProps {
  post: Post
  onOpen: (post: Post) => void
  onDelete?: (post: Post) => void
  tagColor: (name: string) => string | undefined
  className?: string
  readOnly?: boolean
}

function initials(name?: string | null, handle?: string | null): string {
  const source = (name || handle || '?').replace(/^@/, '').trim()
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return source.slice(0, 2).toUpperCase()
}

/** Round play affordance shown on top of a video poster. */
function PlayOverlay({ duration }: { duration?: number | null }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <span className="bg-background/80 text-foreground flex size-12 items-center justify-center rounded-full shadow-lg backdrop-blur-sm">
        <Play className="size-5 fill-current" />
      </span>
      {duration ? (
        <span className="bg-background/85 text-foreground absolute right-2 bottom-2 rounded px-1.5 py-0.5 text-xxs font-medium tabular-nums">
          {formatDuration(duration)}
        </span>
      ) : null}
    </div>
  )
}

/** Video card media: previews a muted, looped playback on hover. */
function CardVideo({
  post,
  video,
  onOpen,
  compact = false,
}: {
  post: Post
  video: MediaItem
  onOpen: (p: Post) => void
  compact?: boolean
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [naturalRatio, setNaturalRatio] = useState<number | null>(null)
  const aspectRatio = naturalRatio ?? (
    video.width && video.height ? video.width / video.height
      : post.width && post.height ? post.width / post.height : 16 / 9
  )

  const play = useCallback(() => {
    const v = ref.current
    if (v) {
      v.muted = true
      v.play().catch(() => {})
    }
    setPlaying(true)
  }, [])

  const stop = useCallback(() => {
    const v = ref.current
    if (v) {
      v.pause()
      try {
        v.currentTime = 0
      } catch {
        /* ignore */
      }
    }
    setPlaying(false)
  }, [])

  return (
    <button
      type="button"
      onClick={() => onOpen(post)}
      onMouseEnter={play}
      onMouseLeave={stop}
      onFocus={play}
      onBlur={stop}
      className="group bg-muted relative block w-full overflow-hidden"
      style={{ aspectRatio: compact ? 1 : aspectRatio }}
      aria-label="播放视频"
    >
      {/* 封面：独立 <img>，未播放时可见 */}
      {post.poster_url ? (
        <img
          src={post.poster_url}
          alt="视频封面"
          loading="lazy"
          className="size-full object-contain"
        />
      ) : null}
      {/* 视频：hover 播放时淡入，覆盖封面 */}
      <video
        ref={ref}
        src={video.url}
        muted
        loop
        playsInline
        preload="metadata"
        onLoadedMetadata={(event) => {
          const element = event.currentTarget
          if (element.videoWidth && element.videoHeight) {
            setNaturalRatio(element.videoWidth / element.videoHeight)
          }
        }}
        className={cn(
          'absolute inset-0 size-full object-contain transition-opacity duration-300',
          playing || !post.poster_url ? 'opacity-100' : 'opacity-0',
        )}
      />
      {!playing ? <PlayOverlay duration={post.duration ?? video.duration} /> : null}
    </button>
  )
}

/** Multi-media posts use a stable-height carousel with uncropped media. */
function PostMedia({ post, onOpen }: { post: Post; onOpen: (p: Post) => void }) {
  const media = useMemo(
    () => [...(post.media ?? [])]
      .filter((m) => m.kind === 'image' || m.kind === 'video' || m.kind === 'gif')
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    [post.media],
  )
  const [selected, setSelected] = useState(0)
  const index = Math.min(selected, Math.max(0, media.length - 1))
  const item = media[index]
  const multiple = media.length > 1
  if (!item) return null

  return (
    <div className="bg-muted relative w-full overflow-hidden">
      {item.kind === 'video' || (item.kind === 'gif' && item.mime?.startsWith('video/')) ? (
        <CardVideo key={item.url} post={post} video={item} onOpen={onOpen} compact={multiple} />
      ) : (
        <button type="button" onClick={() => onOpen(post)}
          className={cn('block w-full', multiple && 'aspect-square')} aria-label="查看图片">
          <img src={item.url} alt="" loading="lazy"
            className={multiple ? 'block size-full object-contain' : 'block h-auto w-full'} />
        </button>
      )}
      {multiple ? (
        <>
          <button type="button" aria-label="上一张"
            onClick={() => setSelected((index - 1 + media.length) % media.length)}
            className="absolute left-2 top-1/2 z-20 -translate-y-1/2 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70">
            <ChevronLeft className="size-5" />
          </button>
          <button type="button" aria-label="下一张"
            onClick={() => setSelected((index + 1) % media.length)}
            className="absolute right-2 top-1/2 z-20 -translate-y-1/2 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70">
            <ChevronRight className="size-5" />
          </button>
          <span className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-2.5 py-1 text-xxs tabular-nums text-white">
            {index + 1} / {media.length}
          </span>
        </>
      ) : null}
    </div>
  )
}

/** Author row: avatar + name + handle + timestamp, with optional right-side slot. */
function AuthorHeader({
  post,
  children,
}: {
  post: Post
  children?: ReactNode
}) {
  const [imgOk, setImgOk] = useState(true)

  useEffect(() => setImgOk(true), [post.author_avatar])

  return (
    <div className="flex items-start justify-between gap-3 px-4 pt-3 pb-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <Avatar className="size-8 shrink-0">
          {post.author_avatar && imgOk ? (
            <AvatarImage
              src={post.author_avatar}
              alt={post.author_name ?? ''}
              onError={() => setImgOk(false)}
            />
          ) : null}
          <AvatarFallback className="text-xxs">
            {initials(post.author_name, post.author_handle)}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <span className="truncate text-xsm font-semibold">
              {post.author_name || post.author_handle || '未知作者'}
            </span>
            {post.author_verified ? (
              <BadgeCheck className="size-3.5 shrink-0 text-sky-500" />
            ) : null}
          </div>
          <div className="truncate text-xxs text-muted-foreground">
            {post.author_handle ? `@${post.author_handle.replace(/^@/, '')}` : ''}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <time className="text-xxs tabular-nums text-muted-foreground">{formatDate(post.created_at)}</time>
        {children ? <div className="pointer-events-auto flex items-center gap-1">{children}</div> : null}
      </div>
    </div>
  )
}

export function PostCard({ post, onOpen, onDelete, tagColor, className, readOnly }: PostCardProps) {
  const failed = post.status === 'failed'
  const hasMedia = (post.media?.length ?? 0) > 0

  const kindLabel = post.media_kind === 'video' ? '视频' : post.media_kind === 'image' ? '图片' : '文字'

  const menu = !readOnly ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground size-7 opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100"
          aria-label="更多操作"
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="agndex-dashboard w-40">
        <DropdownMenuItem onClick={() => onOpen(post)}>
          <StickyNote className="size-4" />
          查看详情
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => window.open(post.url, '_blank', 'noreferrer')}>
          <ExternalLink className="size-4" />
          在 X 打开
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => triggerDownload(post.id)}>
          <Download className="size-4" />
          下载素材
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => onDelete?.(post)}>
          <Trash2 className="size-4" />
          删除
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null

  return (
    <article
      className={cn(
        'group bg-card text-card-foreground flex w-full flex-col self-start overflow-hidden rounded-xl border border-transparent transition-colors',
        'hover:border-border/60 focus-within:border-primary/50',
        className,
      )}
    >
      <AuthorHeader post={post}>{menu}</AuthorHeader>
      {hasMedia ? (
        <div className="relative mx-4 overflow-hidden rounded-lg shadow-sm">
          <PostMedia post={post} onOpen={onOpen} />
        </div>
      ) : null}

      {/* body：仅纯文本推文展示正文；媒体卡片只保留标签/元信息 */}
      <div className="flex flex-col gap-2 px-3 pb-3 pt-4">
        {failed ? (
          <div className="text-destructive flex min-w-0 items-start gap-2 rounded-md bg-destructive/10 px-2.5 py-2 text-xxs">
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            <span className="min-w-0 break-all">{post.error || '下载失败'}</span>
          </div>
        ) : null}

        {!hasMedia && post.text ? (
          <p className="text-xsm leading-relaxed break-words whitespace-pre-wrap">{post.text}</p>
        ) : null}

        {!hasMedia && post.note ? (
          <p className="border-primary/40 text-muted-foreground border-l-2 pl-2 text-xxs leading-relaxed break-words">
            {post.note}
          </p>
        ) : null}

        {post.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {post.tags.slice(0, 2).map((name) => {
              const color = tagColor(name)
              return (
                <Badge
                  key={name}
                  variant="outline"
                  className="rounded-md px-1.5 py-1 text-xxs font-normal"
                  style={
                    color
                      ? {
                          backgroundColor: hexToRgba(color, 0.06),
                          borderColor: hexToRgba(color, 0.18),
                          color,
                        }
                      : undefined
                  }
                >
                  {name}
                </Badge>
              )
            })}
            {post.tags.length > 2 ? (
              <Badge variant="outline" title={post.tags.slice(2).join('、')}
                className="rounded-md px-1.5 py-1 text-xxs font-normal">
                +{post.tags.length - 2}
              </Badge>
            ) : null}
          </div>
        ) : null}

        {/* footer */}
        <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-x-2 gap-y-1 pt-1 text-xxs">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <Heart className="size-3" />
              {formatCount(post.favorite_count)}
            </span>
            <span className="inline-flex items-center gap-1">
              <MessageCircle className="size-3" />
              {formatCount(post.reply_count)}
            </span>
          </div>
          <div className="flex items-center gap-2 tabular-nums">
            {post.width && post.height ? <span className="hidden 2xl:inline">{post.width}×{post.height}</span> : null}
            <span>{kindLabel}</span>
            <span>{formatSize(post.total_size ?? post.size_bytes)}</span>
            <button
              type="button"
              onClick={() => (readOnly ? triggerPublicDownload(post.id) : triggerDownload(post.id))}
              aria-label="下载素材"
              title="下载素材"
              className="text-muted-foreground hover:text-foreground inline-flex items-center rounded p-0.5 transition-colors"
            >
              <Download className="size-3.5" />
            </button>
          </div>
        </div>
      </div>
    </article>
  )
}
