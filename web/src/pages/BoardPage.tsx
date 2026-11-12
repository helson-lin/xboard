import { AlertTriangle, Inbox } from 'lucide-react'

import { PostCard } from '@/components/board/PostCard'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { Post } from '@/lib/types'

const SKELETONS = Array.from({ length: 6 }, (_, i) => i)

export function BoardPage({
  posts,
  loading,
  error,
  view,
  onOpen,
  onDelete,
  tagColor,
  onAdd,
}: {
  posts: Post[]
  loading: boolean
  error: string | null
  view: 'grid' | 'list'
  onOpen: (post: Post) => void
  onDelete: (post: Post) => void
  tagColor: (name: string) => string | undefined
  onAdd: () => void
}) {
  return (
    <div>
      {error ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {loading && posts.length === 0 ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,20rem),1fr))] gap-4">
          {SKELETONS.map((i) => (
            <Skeleton key={i} className="h-72 rounded-xl" />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-20 text-center">
          <Inbox className="size-8 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">还没有推文</p>
            <p className="mt-1 text-xs text-muted-foreground">
              粘贴 X 链接开始归档
            </p>
          </div>
          <Button size="sm" onClick={onAdd}>
            添加推文
          </Button>
        </div>
      ) : (
        <div
          className={
            view === 'grid'
              ? 'w-full columns-[20rem] gap-4'
              : 'flex flex-col gap-3'
          }
        >
          {posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              onOpen={onOpen}
              onDelete={onDelete}
              tagColor={tagColor}
              className={
                view === 'grid'
                  ? 'mb-4 max-w-full break-inside-avoid-column'
                  : undefined
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}
