import { RefreshCw } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { Job } from '@/lib/types'
import { timeAgo } from '@/lib/format'

function statusVariant(
  status: string
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'done') return 'secondary'
  if (status === 'failed') return 'destructive'
  if (status === 'running') return 'default'
  return 'outline'
}

const STATUS_LABEL: Record<string, string> = {
  queued: '排队中',
  running: '下载中',
  done: '已完成',
  failed: '失败',
}

export function JobsPage({
  jobs,
  onRetry,
  onRefresh,
  busy,
  loading,
}: {
  jobs: Job[]
  onRetry: (id: string) => Promise<void> | void
  onRefresh: () => void
  busy: boolean
  loading: boolean
}) {
  const pending = jobs.filter(
    (j) => j.status === 'queued' || j.status === 'running'
  ).length

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="mr-auto">
          <h2 className="text-sm font-semibold">下载任务</h2>
          <p className="text-xs text-muted-foreground">
            共 {jobs.length} 个任务，{pending} 个进行中
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={onRefresh}
          disabled={loading}
        >
          <RefreshCw className={loading ? 'animate-spin' : undefined} />
          刷新
        </Button>
      </div>

      <Card className="gap-0 py-0">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">状态</TableHead>
                <TableHead>链接</TableHead>
                <TableHead className="hidden w-40 md:table-cell">
                  阶段 / 错误
                </TableHead>
                <TableHead className="w-28 text-right">时间</TableHead>
                <TableHead className="w-20 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="h-24 text-center text-sm text-muted-foreground"
                  >
                    暂无任务
                  </TableCell>
                </TableRow>
              ) : (
                jobs.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell>
                      <Badge variant={statusVariant(job.status)}>
                        {STATUS_LABEL[job.status] ?? job.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-0">
                      <a
                        href={job.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate text-xs text-muted-foreground hover:text-foreground hover:underline"
                        title={job.url}
                      >
                        {job.url}
                      </a>
                    </TableCell>
                    <TableCell className="hidden max-w-0 md:table-cell">
                      <span
                        className={
                          job.error
                            ? 'block truncate text-xs text-destructive'
                            : 'block truncate text-xs text-muted-foreground'
                        }
                        title={job.error ?? job.stage ?? ''}
                      >
                        {job.error ?? job.stage ?? '—'}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {job.updated_at
                        ? timeAgo(job.updated_at)
                        : job.created_at
                          ? timeAgo(job.created_at)
                          : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {job.status === 'failed' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => onRetry(job.id)}
                          disabled={busy}
                        >
                          重试
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}