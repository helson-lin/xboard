import { useCallback, useEffect, useRef, useState } from 'react'
import { Inbox, Loader2, Search, X, LayoutGrid, Hash, Home } from 'lucide-react'

import { PostCard } from '@/components/board/PostCard'
import { PostLightbox } from '@/components/board/PostLightbox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { publicApi } from '@/lib/publicApi'
import type { Post, SortKey, Tag } from '@/lib/types'

const PAGE = 24

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'added', label: '最近入库' },
  { value: 'new', label: '发布时间 ↓' },
  { value: 'old', label: '发布时间 ↑' },
  { value: 'size', label: '体积' },
  { value: 'duration', label: '时长' },
]

const SKELETONS = Array.from({ length: 6 }, (_, i) => i)

function chipClass(active: boolean): string {
  return `flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${
    active
      ? 'border-primary bg-primary text-primary-foreground'
      : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground'
  }`
}

export default function PublicHome() {
  const [posts, setPosts] = useState<Post[]>([])
  const [total, setTotal] = useState(0)
  const [tags, setTags] = useState<Tag[]>([])
  const [tag, setTag] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<SortKey>('added')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [hasMore, setHasMore] = useState(false)

  const offsetRef = useRef(0)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const busyRef = useRef(false)

  useEffect(() => {
    publicApi
      .tags()
      .then((res) => setTags(res.items))
      .catch(() => {})
  }, [])

  // First page: reset whenever the filter/sort/search changes.
  useEffect(() => {
    let alive = true
    busyRef.current = true
    setLoading(true)
    setError(null)
    publicApi
      .listPosts({ tag, kind: null, q, sort }, PAGE, 0)
      .then((res) => {
        if (!alive) return
        setPosts(res.items)
        setTotal(res.total)
        offsetRef.current = res.items.length
        setHasMore(res.items.length < res.total)
        setSelected(null)
      })
      .catch((err) => {
        if (!alive) return
        setError(err instanceof Error ? err.message : '加载失败')
      })
      .finally(() => {
        if (!alive) return
        setLoading(false)
        busyRef.current = false
      })
    return () => {
      alive = false
      busyRef.current = false
    }
  }, [tag, q, sort])

  const loadMore = useCallback(() => {
    if (busyRef.current || loading || !hasMore) return
    busyRef.current = true
    setLoadingMore(true)
    publicApi
      .listPosts({ tag, kind: null, q, sort }, PAGE, offsetRef.current)
      .then((res) => {
        setPosts((prev) => {
          const seen = new Set(prev.map((p) => p.id))
          return [...prev, ...res.items.filter((p) => !seen.has(p.id))]
        })
        offsetRef.current += res.items.length
        setHasMore(offsetRef.current < res.total)
      })
      .catch(() => {
        // Ignore transient load-more failures; the sentinel retries on scroll.
      })
      .finally(() => {
        setLoadingMore(false)
        busyRef.current = false
      })
  }, [tag, q, sort, loading, hasMore])

  // Infinite scroll: observe a sentinel below the grid.
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore()
      },
      { rootMargin: '600px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [loadMore])

  const tagColor = useCallback(
    (name: string) => tags.find((t) => t.name === name)?.color ?? undefined,
    [tags],
  )

  const openPost = useCallback(
    (post: Post) => {
      const i = posts.findIndex((p) => p.id === post.id)
      if (i >= 0) setSelected(i)
    },
    [posts],
  )

  return (
    <div className="agndex-dashboard min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0">
            <a href="/" className="flex items-center gap-2 rounded-xl bg-muted px-2.5 py-2 text-base font-semibold">
              <LayoutGrid className="size-7 rounded-lg bg-foreground p-1.5 text-background" />
              XBoard
            </a>
          </div>

          <div className="relative ml-auto w-full max-w-xs">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索推文…"
              className="pl-8 pr-8"
            />
            {q ? (
              <button
                type="button"
                onClick={() => setQ('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="清空搜索"
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>

        </div>

        {tags.length > 0 ? (
          <div className="flex gap-2 overflow-x-auto px-4 pb-3 md:hidden [scrollbar-width:none]">
            <button type="button" onClick={() => setTag(null)} className={chipClass(tag === null)}>
              全部
            </button>
            {tags.map((t) => (
              <button
                key={t.name}
                type="button"
                onClick={() => setTag(tag === t.name ? null : t.name)}
                className={chipClass(tag === t.name)}
              >
                {t.name}
                <span className="opacity-70">{t.count}</span>
              </button>
            ))}
          </div>
        ) : null}
      </header>

      <div className="flex">
        <aside className="sticky top-[73px] hidden h-[calc(100vh-73px)] w-52 shrink-0 overflow-y-auto border-r border-border/40 px-4 py-4 md:block" aria-label="推文分类">
          <p className="mb-3 px-2 text-xxs font-medium tracking-wide text-muted-foreground">浏览分类</p>
          <button type="button" onClick={() => setTag(null)}
            className={`mb-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${tag === null ? 'bg-muted font-semibold' : 'text-muted-foreground hover:bg-muted'}`}>
            <Home className="size-4" /> 全部推文
          </button>
          {tags.filter((t) => t.count > 0).map((t) => (
            <button key={t.name} type="button" onClick={() => setTag(tag === t.name ? null : t.name)}
              className={`mb-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${tag === t.name ? 'bg-muted font-semibold' : 'text-muted-foreground hover:bg-muted'}`}>
              <Hash className="size-3.5 opacity-60" />
              <span className="truncate">{t.name}</span>
              <span className="ml-auto text-xxs opacity-60">{t.count}</span>
            </button>
          ))}
        </aside>

      <main className="min-w-0 flex-1 px-4 py-5">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{tag ? `${tag} · 推文灵感` : '推文灵感收藏'}</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">浏览收藏的图片、视频与创意 · {total} 条推文</p>
          </div>
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger className="w-40 bg-background text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{SORTS.map((s) => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}</SelectContent>
          </Select>
        </div>
        {error ? (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <span>{error}</span>
          </div>
        ) : null}

        {loading && posts.length === 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {SKELETONS.map((i) => (
              <Skeleton key={i} className="h-72 rounded-xl" />
            ))}
          </div>
        ) : posts.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-20 text-center">
            <Inbox className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">这里还没有公开的推文</p>
          </div>
        ) : (
          <div className="columns-1 gap-3 sm:columns-2 xl:columns-3">
            {posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                onOpen={openPost}
                tagColor={tagColor}
                className="mb-3 break-inside-avoid"
                readOnly
              />
            ))}
          </div>
        )}

        <div ref={sentinelRef} className="h-px" aria-hidden="true" />

        {loadingMore ? (
          <div className="mt-6 flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            加载中…
          </div>
        ) : !hasMore && posts.length > 0 ? (
          <p className="mt-6 text-center text-xs text-muted-foreground">
            已加载全部 {posts.length} 条
          </p>
        ) : null}
      </main>
      </div>

      <PostLightbox
        posts={posts}
        index={selected ?? 0}
        open={selected !== null}
        onClose={() => setSelected(null)}
        onNavigate={(i) => setSelected(i)}
        tagColor={tagColor}
        busy={false}
        readOnly
      />
    </div>
  )
}
