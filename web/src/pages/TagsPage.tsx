import { useState } from 'react'
import { Pencil, Plus, Tag as TagIcon, Trash2 } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { Tag } from '@/lib/types'
import { hexToRgba } from '@/lib/format'

export function TagsPage({
  tags,
  untagged,
  onCreate,
  onRename,
  onDelete,
  onPick,
  busy,
}: {
  tags: Tag[]
  untagged: number
  onCreate: (name: string, color: string) => Promise<void> | void
  onRename: (from: string, to: string) => Promise<void> | void
  onDelete: (tag: Tag) => Promise<void> | void
  onPick: (name: string) => void
  busy: boolean
}) {
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<Tag | null>(null)
  const [name, setName] = useState('')
  const [color, setColor] = useState('#c084fc')

  const openCreate = () => {
    setName('')
    setColor('#c084fc')
    setCreating(true)
  }

  const openRename = (tag: Tag) => {
    setName(tag.name)
    setRenaming(tag)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="mr-auto">
          <h2 className="text-sm font-semibold">标签</h2>
          <p className="text-xs text-muted-foreground">
            共 {tags.length} 个标签，{untagged} 条推文未归类
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={openCreate}>
          <Plus />
          新建标签
        </Button>
      </div>

      <Card className="gap-0 py-0">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>标签</TableHead>
                <TableHead className="w-24 text-right">推文数</TableHead>
                <TableHead className="w-32 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tags.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={3}
                    className="h-24 text-center text-sm text-muted-foreground"
                  >
                    还没有标签
                  </TableCell>
                </TableRow>
              ) : (
                tags.map((tag) => (
                  <TableRow key={tag.name}>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => onPick(tag.name)}
                        className="inline-flex items-center gap-2 text-sm hover:underline"
                      >
                        <span
                          className="size-2.5 rounded-full"
                          style={{
                            backgroundColor:
                              tag.color ?? 'var(--muted-foreground)',
                          }}
                        />
                        {tag.name}
                      </button>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                      {tag.count}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          onClick={() => openRename(tag)}
                          aria-label="重命名"
                        >
                          <Pencil />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7 text-destructive"
                          onClick={() => onDelete(tag)}
                          disabled={busy}
                          aria-label="删除"
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>新建标签</DialogTitle>
            <DialogDescription>标签用于对推文分类与筛选。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="tag-name">名称</Label>
              <Input
                id="tag-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：技术"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tag-color">颜色</Label>
              <div className="flex items-center gap-2">
                <input
                  id="tag-color"
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="size-9 cursor-pointer rounded-md border border-border bg-transparent"
                />
                <Badge
                  variant="outline"
                  style={{
                    borderColor: hexToRgba(color, 0.5),
                    color,
                  }}
                >
                  {name || '预览'}
                </Badge>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>
              取消
            </Button>
            <Button
              className="gap-1.5"
              disabled={!name.trim() || busy}
              onClick={async () => {
                await onCreate(name.trim(), color)
                setCreating(false)
              }}
            >
              <TagIcon />
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>重命名标签</DialogTitle>
            <DialogDescription>
              所有使用该标签的推文会一起更新。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="tag-rename">新名称</Label>
            <Input
              id="tag-rename"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(null)}>
              取消
            </Button>
            <Button
              disabled={!name.trim() || name === renaming?.name || busy}
              onClick={async () => {
                if (renaming) await onRename(renaming.name, name.trim())
                setRenaming(null)
              }}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}