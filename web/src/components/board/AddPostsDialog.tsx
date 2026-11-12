import { useState } from 'react'
import { Download, Link2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

export function AddPostsDialog({
  open,
  onOpenChange,
  onSubmit,
  busy,
  autoTag,
  onAutoTag,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (urls: string[]) => Promise<void> | void
  busy: boolean
  autoTag: boolean
  onAutoTag: (value: boolean) => void
}) {
  const [raw, setRaw] = useState('')

  const urls = raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)

  const submit = async () => {
    if (!urls.length) return
    await onSubmit(urls)
    setRaw('')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="min-w-0 overflow-hidden sm:max-w-lg">
        <DialogHeader className="min-w-0">
          <DialogTitle>添加推文</DialogTitle>
          <DialogDescription>
            粘贴 X 推文链接，每行一个。下载完成后会自动进行标签归类。
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-4">
          <div className="min-w-0 space-y-2">
            <Label htmlFor="xboard-urls">推文链接</Label>
            <Textarea
              id="xboard-urls"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              rows={6}
              autoFocus
              placeholder={'https://x.com/user/status/1234567890\nhttps://x.com/user/status/9876543210'}
              className="field-sizing-fixed min-w-0 max-w-full break-all font-mono text-xs"
            />
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Link2 className="size-3.5" />
              已识别 {urls.length} 个链接
            </p>
          </div>

          <div className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border p-3">
            <div className="min-w-0 space-y-0.5">
              <Label htmlFor="xboard-autotag" className="text-sm">
                自动归类标签
              </Label>
              <p className="break-words text-xs text-muted-foreground">
                使用已配置的模型对正文与媒体打标签
              </p>
            </div>
            <Switch
              id="xboard-autotag"
              checked={autoTag}
              onCheckedChange={onAutoTag}
            />
          </div>
        </div>

        <DialogFooter className="min-w-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            className="gap-1.5"
            onClick={submit}
            disabled={!urls.length || busy}
          >
            <Download />
            加入下载队列
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
