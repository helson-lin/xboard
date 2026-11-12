import { ThemeToggle } from '@/components/agndex/theme-toggle'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SidebarTrigger } from '@/components/ui/sidebar'
import type { SortKey } from '@/lib/types'
import { LayoutGrid, Plus, Search, Rows3, X } from 'lucide-react'
import type { PageKey } from './AppSidebar'

const TITLES: Record<PageKey, { title: string; subtitle: string }> = {
  board: { title: '看板', subtitle: '所有已归档的 X 推文与媒体' },
  tags: { title: '标签', subtitle: '管理自动归类产生的标签' },
  jobs: { title: '任务', subtitle: '下载与抓取队列' },
  settings: { title: '设置', subtitle: '抓取与自动归类参数' },
}

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'added', label: '最近入库' },
  { value: 'new', label: '发布时间 ↓' },
  { value: 'old', label: '发布时间 ↑' },
  { value: 'size', label: '体积' },
  { value: 'duration', label: '时长' },
]

export function AppTopbar({
  page,
  q,
  onQ,
  sort,
  onSort,
  view,
  onView,
  onAdd,
  loading,
}: {
  page: PageKey
  q: string
  onQ: (q: string) => void
  sort: SortKey
  onSort: (s: SortKey) => void
  view: 'grid' | 'list'
  onView: (v: 'grid' | 'list') => void
  onAdd: () => void
  loading: boolean
}) {
  const meta = TITLES[page]

  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b border-border/60 px-3 sm:px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 h-6" />

      <div className="mr-auto min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="truncate text-sm font-semibold">{meta.title}</h1>
          {loading ? (
            <span className="text-xs text-muted-foreground">同步中…</span>
          ) : null}
        </div>
        <p className="hidden truncate text-xs text-muted-foreground sm:block">
          {meta.subtitle}
        </p>
      </div>

      {page === 'board' ? (
        <>
          <div className="relative hidden md:block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => onQ(e.target.value)}
              placeholder="搜索正文 / 作者…"
              aria-label="搜索正文或作者"
              className="w-56 pl-8 lg:w-72"
            />
            {q ? (
              <button
                type="button"
                onClick={() => onQ('')}
                aria-label="清空搜索"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>

          <Select value={sort} onValueChange={(v) => onSort(v as SortKey)}>
            <SelectTrigger className="hidden w-36 sm:flex" aria-label="排序">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORTS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="hidden items-center rounded-md border border-border p-0.5 sm:flex">
            <Button
              size="icon"
              variant={view === 'grid' ? 'secondary' : 'ghost'}
              className="size-7"
              onClick={() => onView('grid')}
              aria-label="网格视图"
            >
              <LayoutGrid />
            </Button>
            <Button
              size="icon"
              variant={view === 'list' ? 'secondary' : 'ghost'}
              className="size-7"
              onClick={() => onView('list')}
              aria-label="列表视图"
            >
              <Rows3 />
            </Button>
          </div>
        </>
      ) : null}

      <Button size="sm" onClick={onAdd} className="gap-1.5" aria-label="添加推文">
        <Plus />
        <span className="hidden sm:inline">添加推文</span>
      </Button>
      <ThemeToggle />
    </header>
  )
}
