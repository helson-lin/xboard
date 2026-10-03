import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import type { Filters, MediaKind, Tag } from '@/lib/types'
import { cn } from '@/lib/utils'
import { RotateCcw, Sparkles } from 'lucide-react'

const KINDS: { value: MediaKind | null; label: string }[] = [
  { value: null, label: '全部' },
  { value: 'video', label: '视频' },
  { value: 'image', label: '图片' },
  { value: 'text', label: '纯文字' },
]

export function TagFilterBar({
  tags,
  untagged,
  filters,
  tagCounts,
  onToggleTag,
  onKind,
  onReset,
  onRetagAll,
  busy,
  loading,
}: {
  tags: Tag[]
  untagged: number
  filters: Filters
  tagCounts: Record<string, number>
  onToggleTag: (name: string) => void
  onKind: (kind: MediaKind | null) => void
  onReset: () => void
  onRetagAll: () => void
  busy: boolean
  loading: boolean
}) {
  const dirty =
    filters.tag !== null || filters.kind !== null || filters.q.trim() !== ''

  return (
    <div className="sticky top-0 z-10 -mx-4 mb-4 border-b border-border/60 bg-background/80 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">类型</span>
        {KINDS.map((k) => (
          <Button
            key={k.label}
            size="sm"
            variant={filters.kind === k.value ? 'default' : 'outline'}
            className="h-7 rounded-full px-3 text-xs"
            onClick={() => onKind(k.value)}
          >
            {k.label}
          </Button>
        ))}
        <Separator orientation="vertical" className="mx-1 h-5" />
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 px-2 text-xs"
          onClick={onRetagAll}
          disabled={busy}
        >
          <Sparkles className="size-3.5" />
          全部重新归类
        </Button>
        {dirty ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-xs text-muted-foreground"
            onClick={onReset}
          >
            <RotateCcw className="size-3.5" />
            重置
          </Button>
        ) : null}
      </div>

      <div className="custom-scrollbar-x mt-2 flex items-center gap-1.5 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
        <span className="text-xs font-medium text-muted-foreground">标签</span>
        {loading && tags.length === 0 ? (
          <>
            <Skeleton className="h-6 w-16 rounded-full" />
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-6 w-14 rounded-full" />
          </>
        ) : null}
        {tags.map((t) => {
          const active = filters.tag === t.name
          const count = tagCounts[t.name] ?? t.count
          return (
            <button
              key={t.name}
              type="button"
              onClick={() => onToggleTag(t.name)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
                active
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground'
              )}
            >
              <span
                className="size-1.5 rounded-full"
                style={{
                  backgroundColor: active
                    ? 'currentColor'
                    : (t.color ?? 'var(--muted-foreground)'),
                }}
              />
              {t.name}
              <span className={cn('tabular-nums', active ? 'opacity-80' : 'opacity-60')}>
                {count}
              </span>
            </button>
          )
        })}
        {untagged > 0 ? (
          <Badge variant="outline" className="font-normal text-muted-foreground">
            未归类 {untagged}
          </Badge>
        ) : null}
      </div>
    </div>
  )
}
