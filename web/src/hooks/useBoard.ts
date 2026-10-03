import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api } from '@/lib/api'
import type { Author, Filters, Job, Post, SortKey, Stats, Tag } from '@/lib/types'

function useDebounced<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(t)
  }, [value, delay])
  return debounced
}

const EMPTY_FILTERS: Filters = {
  tag: null,
  kind: null,
  q: '',
  author: null,
  sort: 'new',
}

/**
 * Owns all board state: the filtered post list, facet counts, download jobs and
 * server stats. Polls the backend while jobs are still in flight so cards
 * appear as soon as yt-dlp finishes.
 */
export function useBoard() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [posts, setPosts] = useState<Post[]>([])
  const [total, setTotal] = useState(0)
  const [tags, setTags] = useState<Tag[]>([])
  const [untagged, setUntagged] = useState(0)
  const [authors, setAuthors] = useState<Author[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const debouncedQ = useDebounced(filters.q, 350)
  const activeFilters = useMemo<Filters>(
    () => ({ ...filters, q: debouncedQ }),
    [filters, debouncedQ],
  )

  const loadPosts = useCallback(async () => {
    try {
      const page = await api.listPosts(activeFilters, 120, 0)
      setPosts(page.items)
      setTotal(page.total)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [activeFilters])

  const loadFacets = useCallback(async () => {
    const [t, a, s] = await Promise.allSettled([api.tags(), api.authors(), api.stats()])
    if (t.status === 'fulfilled') {
      setTags(t.value.items)
      setUntagged(t.value.untagged ?? 0)
    }
    if (a.status === 'fulfilled') setAuthors(a.value.items)
    if (s.status === 'fulfilled') setStats(s.value)
  }, [])

  const loadJobs = useCallback(async () => {
    try {
      const r = await api.listJobs(40)
      setJobs(r.items)
    } catch {
      /* job panel is best-effort */
    }
  }, [])

  const refresh = useCallback(async () => {
    await Promise.all([loadPosts(), loadFacets(), loadJobs()])
  }, [loadPosts, loadFacets, loadJobs])

  // Post list follows the active filters.
  useEffect(() => {
    setLoading(true)
    void loadPosts()
  }, [loadPosts])

  // Facets and jobs poll; poll harder while downloads are running.
  const pending = stats?.pending_jobs ?? 0
  const busy = pending > 0 || jobs.some((j) => j.status === 'queued' || j.status === 'running')
  const lastBusy = useRef(false)

  useEffect(() => {
    void loadFacets()
    void loadJobs()
  }, [loadFacets, loadJobs])

  useEffect(() => {
    const period = busy ? 2500 : 15000
    const id = window.setInterval(() => {
      void loadJobs()
      if (busy) void loadPosts()
      else void loadFacets()
    }, period)
    return () => window.clearInterval(id)
  }, [busy, loadJobs, loadPosts, loadFacets])

  // The moment the last job drains, do one full refresh so finished posts show.
  useEffect(() => {
    if (lastBusy.current && !busy) void refresh()
    lastBusy.current = busy
  }, [busy, refresh])

  const patchFilters = useCallback((patch: Partial<Filters>) => {
    setFilters((prev) => ({ ...prev, ...patch }))
  }, [])

  const toggleTag = useCallback((name: string) => {
    setFilters((prev) => ({ ...prev, tag: prev.tag === name ? null : name }))
  }, [])

  const setSort = useCallback((sort: SortKey) => {
    setFilters((prev) => ({ ...prev, sort }))
  }, [])

  const resetFilters = useCallback(() => setFilters(EMPTY_FILTERS), [])

  const addPosts = useCallback(
    async (urls: string[]) => {
      const r = await api.download(urls)
      await Promise.all([loadJobs(), loadFacets()])
      return r
    },
    [loadJobs, loadFacets],
  )

  const removePost = useCallback(
    async (id: string) => {
      await api.deletePost(id, true)
      setPosts((prev) => prev.filter((p) => p.id !== id))
      await Promise.all([loadFacets(), loadJobs()])
    },
    [loadFacets, loadJobs],
  )

  const updatePost = useCallback(async (id: string, patch: { note?: string; tags?: string[] }) => {
    const updated = await api.updatePost(id, patch)
    setPosts((prev) => prev.map((p) => (p.id === id ? { ...p, ...updated } : p)))
    return updated
  }, [])

  const retagPost = useCallback(async (id: string) => {
    const r = await api.retagPost(id)
    setPosts((prev) => prev.map((p) => (p.id === id ? { ...p, tags: r.tags } : p)))
    return r.tags
  }, [])

  const retagAll = useCallback(async () => {
    const r = await api.retagAll()
    await Promise.all([loadPosts(), loadFacets()])
    return r
  }, [loadPosts, loadFacets])

  const retryJob = useCallback(
    async (id: string) => {
      await api.retryJob(id)
      await loadJobs()
    },
    [loadJobs],
  )

  const tagCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const t of tags) m[t.name] = t.count
    return m
  }, [tags])

  const tagColor = useCallback(
    (name: string) => tags.find((t) => t.name === name)?.color ?? undefined,
    [tags]
  )

  return {
    filters,
    activeFilters,
    posts,
    total,
    tags,
    untagged,
    tagCounts,
    tagColor,
    authors,
    stats,
    jobs,
    loading,
    error,
    busy,
    pending,
    patchFilters,
    toggleTag,
    setSort,
    resetFilters,
    refresh,
    addPosts,
    removePost,
    updatePost,
    retagPost,
    retagAll,
    retryJob,
  }
}

export type Board = ReturnType<typeof useBoard>
