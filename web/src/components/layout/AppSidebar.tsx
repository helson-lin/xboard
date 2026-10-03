import { AgndexLogo } from '@/components/agndex/logo'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { Badge } from '@/components/ui/badge'
import type { Stats } from '@/lib/types'
import {
  Download,
  LayoutGrid,
  LogOut,
  RefreshCw,
  Settings,
  Tag as TagIcon,
} from 'lucide-react'
import type { ComponentType, SVGProps } from 'react'

export type PageKey = 'board' | 'tags' | 'jobs' | 'settings'

type IconType = ComponentType<SVGProps<SVGSVGElement>>

const NAV: { key: PageKey; label: string; icon: IconType }[] = [
  { key: 'board', label: '看板', icon: LayoutGrid },
  { key: 'tags', label: '标签', icon: TagIcon },
  { key: 'jobs', label: '任务', icon: Download },
  { key: 'settings', label: '设置', icon: Settings },
]

export function AppSidebar({
  page,
  onNavigate,
  stats,
  pendingJobs,
  onRefresh,
  refreshing,
  onLogout,
}: {
  page: PageKey
  onNavigate: (page: PageKey) => void
  stats: Stats | null
  pendingJobs: number
  onRefresh: () => void
  refreshing: boolean
  onLogout: () => void
}) {
  const { setOpenMobile, isMobile } = useSidebar()

  const go = (key: PageKey) => {
    onNavigate(key)
    if (isMobile) setOpenMobile(false)
  }

  return (
    <Sidebar collapsible="icon" className="border-none h-full">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" onClick={() => go('board')}>
              <AgndexLogo className="size-8 shrink-0" />
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate text-sm font-semibold">XBoard</span>
                <span className="truncate text-xs text-muted-foreground">
                  X 推文归档
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>导航</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((item) => (
                <SidebarMenuItem key={item.key}>
                  <SidebarMenuButton
                    isActive={page === item.key}
                    tooltip={item.label}
                    onClick={() => go(item.key)}
                  >
                    <item.icon />
                    <span>{item.label}</span>
                    {item.key === 'jobs' && pendingJobs > 0 ? (
                      <Badge
                        variant="secondary"
                        className="ml-auto group-data-[collapsible=icon]:hidden"
                      >
                        {pendingJobs}
                      </Badge>
                    ) : null}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="刷新" onClick={onRefresh}>
              <RefreshCw className={refreshing ? 'animate-spin' : undefined} />
              <span>刷新数据</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="退出登录" onClick={onLogout}>
              <LogOut />
              <span>退出登录</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-sidebar-accent/40 p-2 text-center text-[11px] text-muted-foreground group-data-[collapsible=icon]:hidden">
          <div>
            <div className="text-sm font-semibold text-foreground">
              {stats?.posts ?? 0}
            </div>
            推文
          </div>
          <div>
            <div className="text-sm font-semibold text-foreground">
              {stats?.videos ?? 0}
            </div>
            视频
          </div>
          <div>
            <div className="text-sm font-semibold text-foreground">
              {stats?.tags ?? 0}
            </div>
            标签
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
