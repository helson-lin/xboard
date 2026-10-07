import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Loader2 } from 'lucide-react'

import { AddPostsDialog } from '@/components/board/AddPostsDialog'
import { PostLightbox } from '@/components/board/PostLightbox'
import { LoginForm } from '@/components/auth/LoginForm'
import { AppSidebar, type PageKey } from '@/components/layout/AppSidebar'
import { AppTopbar } from '@/components/layout/AppTopbar'
import { SidebarProvider } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useBoard } from '@/hooks/useBoard'
import { BoardPage } from '@/pages/BoardPage'
import { JobsPage } from '@/pages/JobsPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { TagsPage } from '@/pages/TagsPage'
import { api, setUnauthorizedHandler } from '@/lib/api'
import type { Post, Settings, SortKey } from '@/lib/types'

type AuthState = 'loading' | 'authed' | 'anon'

export default function App() {
  const [authState, setAuthState] = useState<AuthState>('loading')

  useEffect(() => {
    setUnauthorizedHandler(() => setAuthState('anon'))
    api
      .me()
      .then(() => setAuthState('authed'))
      .catch(() => setAuthState('anon'))
    return () => setUnauthorizedHandler(null)
  }, [])

  if (authState === 'loading') {
    return (
      <div className="agndex-dashboard flex h-svh w-full items-center justify-center gap-2 bg-background text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        加载中…
      </div>
    )
  }

  if (authState === 'anon') {
    return <LoginForm onSuccess={() => setAuthState('authed')} />
  }

  return (
    <Dashboard
      onLogout={() => {
        void api.logout().catch(() => undefined)
        setAuthState('anon')
      }}
    />
  )
}

function Dashboard({ onLogout }: { onLogout: () => void }) {
  const board = useBoard()
  const {
    posts,
    stats,
    tags,
    untagged,
    filters,
    tagColor,
    jobs,
    loading,
    busy,
    error,
    pending,
    patchFilters,
    setSort,
    refresh,
    addPosts,
    removePost,
    updatePost,
    retagPost,
    retryJob,
  } = board

  const [page, setPage] = useState<PageKey>('board')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Post | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [autoTag, setAutoTag] = useState(true)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [savingSettings, setSavingSettings] = useState(false)

  useEffect(() => {
    const t = window.setTimeout(() => patchFilters({ q: query }), 300)
    return () => window.clearTimeout(t)
  }, [query, patchFilters])

  useEffect(() => {
    if (page !== 'settings') return
    void api
      .settings()
      .then(setSettings)
      .catch(() => undefined)
  }, [page])

  useEffect(() => {
    if (page !== 'jobs') return
    const t = window.setInterval(() => void refresh(), 5000)
    return () => window.clearInterval(t)
  }, [page, refresh])

  const selectedIndex = useMemo(
    () => (selected ? posts.findIndex((p) => p.id === selected.id) : -1),
    [posts, selected]
  )

  const openPost = (post: Post) => {
    setSelected(post)
    setDetailOpen(true)
  }

  const closeDetail = (open: boolean) => {
    setDetailOpen(open)
    if (!open) setSelected(null)
  }

  const handleDelete = async (post: Post) => {
    if (!window.confirm('删除这条推文及其本地媒体文件？')) return
    await removePost(post.id)
    if (selected?.id === post.id) closeDetail(false)
  }

  const handlePickTag = (name: string) => {
    patchFilters({ tag: name })
    setPage('board')
  }

  return (
    <TooltipProvider delayDuration={200}>
      <SidebarProvider
        className="agndex-dashboard h-svh overflow-hidden no-scrollbar"
        style={{ '--sidebar-width': '17.25rem' } as CSSProperties}
      >
        <AppSidebar
          page={page}
          onNavigate={setPage}
          stats={stats}
          pendingJobs={pending}
          onRefresh={() => void refresh()}
          refreshing={loading}
          onLogout={onLogout}
        />
        <main className="flex-1 overflow-y-auto md:bg-sidebar md:p-2">
          <div className="flex h-full flex-col overflow-hidden rounded-xl bg-background">
            <AppTopbar
              page={page}
              q={query}
              onQ={setQuery}
              sort={filters.sort as SortKey}
              onSort={setSort}
              view={view}
              onView={setView}
              onAdd={() => setAddOpen(true)}
              loading={loading}
            />

            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
            {page === 'board' ? (
              <BoardPage
                posts={posts}
                loading={loading}
                error={error}
                view={view}
                onOpen={openPost}
                onDelete={handleDelete}
                tagColor={tagColor}
                onAdd={() => setAddOpen(true)}
              />
            ) : null}

            {page === 'tags' ? (
              <TagsPage
                tags={tags}
                untagged={untagged}
                busy={busy}
                onPick={handlePickTag}
                onCreate={async (name, color) => {
                  await api.createTag(name, color)
                  await refresh()
                }}
                onRename={async (from, to) => {
                  await api.renameTag(from, to)
                  await refresh()
                }}
                onDelete={async (tag) => {
                  if (!window.confirm(`删除标签「${tag.name}」？`)) return
                  if (tag.id === null) return
                  await api.deleteTag(tag.id)
                  await refresh()
                }}
              />
            ) : null}

            {page === 'jobs' ? (
              <JobsPage
                jobs={jobs}
                busy={busy}
                loading={loading}
                onRetry={(id) => void retryJob(id)}
                onRefresh={() => void refresh()}
              />
            ) : null}

            {page === 'settings' ? (
              <SettingsPage
                settings={settings}
                busy={savingSettings}
                onSave={async (patch) => {
                  setSavingSettings(true)
                  try {
                    const next = await api.saveSettings(
                      patch as unknown as Settings
                    )
                    setSettings(next)
                  } finally {
                    setSavingSettings(false)
                  }
                }}
              />
            ) : null}
            </div>
          </div>
        </main>

        <AddPostsDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          busy={busy}
          autoTag={autoTag}
          onAutoTag={setAutoTag}
          onSubmit={async (urls) => {
            await addPosts(urls)
            setPage('jobs')
          }}
        />

        <PostLightbox
          posts={posts}
          index={selectedIndex}
          open={detailOpen}
          onClose={() => closeDetail(false)}
          onNavigate={(i) => {
            const p = posts[i]
            if (p) setSelected(p)
          }}
          onDelete={handleDelete}
          onRetag={(post) => void retagPost(post.id)}
          tags={tags}
          onSaveTags={async (post, tags) => { await updatePost(post.id, { tags }) }}
          onSaveNote={(post, note) => void updatePost(post.id, { note })}
          tagColor={tagColor}
          busy={busy}
        />
      </SidebarProvider>
    </TooltipProvider>
  )
}
