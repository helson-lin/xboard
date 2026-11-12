import { useEffect, useState } from 'react'
import {
  BadgeCheck,
  Download,
  ExternalLink,
  Heart,
  MessageCircle,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import type { MediaItem, Post } from '@/lib/types'
import {
  formatCount,
  formatDate,
  formatDuration,
  formatSize,
  hexToRgba,
  tagInk,
} from '@/lib/format'
import { cn } from '@/lib/utils'
import { triggerDownload } from '@/lib/api'

function Media({ item }: { item: MediaItem }) {
  const ratio =
    item.width && item.height ? `${item.width} / ${item.height}` : undefined

  if (String(item.kind) === 'video') {
    return (
      <video
        src={item.url}
        controls
        playsInline
        preload="metadata"
        className="w-full rounded-lg border border-border bg-black"
        style={{ aspectRatio: ratio }}
      />
    )
  }
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noreferrer"
      className="block overflow-hidden rounded-lg border border-border"
    >
      <img
        src={item.url}
        alt=""
        loading="lazy"
        className="w-full object-cover transition-transform hover:scale-[1.02]"
        style={{ aspectRatio: ratio }}
      />
    </a>
  )
}

export function PostDetailSheet({
  post,
  open,
  onOpenChange,
  onDelete,
  onRetag,
  onSaveNote,
  tagColor,
  busy,
}: {
  post: Post | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onDelete: (post: Post) => void
  onRetag: (post: Post) => void
  onSaveNote: (post: Post, note: string) => void
  tagColor: (name: string) => string | undefined
  busy: boolean
}) {
  const [note, setNote] = useState('')

  useEffect(() => {
    setNote(post?.note ?? '')
  }, [post?.id, post?.note])

  const media = post
    ? post.media?.length
      ? [...post.media].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      : [...(post.videos ?? []), ...(post.images ?? [])]
    : []

  const dirty = post ? note !== (post.note ?? '') : false

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl"
      >
        {post ? (
          <>
            <SheetHeader className="border-b border-border/60 p-4">
              <SheetTitle className="text-base">推文详情</SheetTitle>
              <SheetDescription className="sr-only">
                推文媒体与元数据
              </SheetDescription>
              <div className="mt-3 flex items-start gap-3">
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
                    {post.author_handle ? `@${post.author_handle.replace(/^@/, '')}` : '—'}
                    {post.created_at ? ` · ${formatDate(post.created_at)}` : ''}
                  </div>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8 shrink-0"
                  onClick={() => window.open(post.url, '_blank')}
                  aria-label="在原站打开"
                >
                  <ExternalLink />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8 shrink-0"
                  onClick={() => triggerDownload(post.id)}
                  aria-label="下载素材"
                  title="下载素材"
                >
                  <Download />
                </Button>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-1.5">
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
            </SheetHeader>

            <div className="flex-1 space-y-4 p-4">
              {post.text ? (
                <p className="whitespace-pre-wrap text-sm leading-relaxed">
                  {post.text}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Heart className="size-3.5" />
                  {formatCount(post.favorite_count ?? 0)}
                </span>
                <span className="inline-flex items-center gap-1">
                  <MessageCircle className="size-3.5" />
                  {formatCount(post.reply_count ?? 0)}
                </span>
                {post.duration ? (
                  <span>{formatDuration(post.duration)}</span>
                ) : null}
                {post.total_size || post.size_bytes ? (
                  <span>{formatSize(post.total_size ?? post.size_bytes ?? 0)}</span>
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

              <Separator />

              <div className="space-y-3">
                <div className="text-xs font-medium text-muted-foreground">
                  媒体 {media.length ? `· ${media.length}` : ''}
                </div>
                {media.length ? (
                  <div className="grid gap-3">
                    {media.map((m, i) => (
                      <Media key={m.id ?? `${m.url}-${i}`} item={m} />
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">无媒体文件</p>
                )}
              </div>

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
            </div>

            <SheetFooter className="sticky bottom-0 gap-2 border-t border-border/60 bg-background/95 p-4 backdrop-blur sm:flex-row">
              <Button
                variant="outline"
                className="gap-1.5"
                onClick={() => onRetag(post)}
                disabled={busy}
              >
                <Sparkles />
                重新归类
              </Button>
              <Button
                className="gap-1.5"
                onClick={() => onSaveNote(post, note)}
                disabled={!dirty || busy}
              >
                <RefreshCw />
                保存备注
              </Button>
              <Button
                variant="destructive"
                className={cn('gap-1.5 sm:ml-auto')}
                onClick={() => onDelete(post)}
                disabled={busy}
              >
                <Trash2 />
                删除
              </Button>
            </SheetFooter>
          </>
        ) : (
          <SheetHeader className="p-4">
            <SheetTitle>推文详情</SheetTitle>
            <SheetDescription>未选择推文</SheetDescription>
          </SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  )
}
