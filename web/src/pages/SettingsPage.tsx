import { useEffect, useState } from 'react'
import { Save, Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import type { Settings } from '@/lib/types'

export function SettingsPage({
  settings,
  onSave,
  busy,
}: {
  settings: Settings | null
  onSave: (patch: Record<string, unknown>) => Promise<void> | void
  busy: boolean
}) {
  const [concurrency, setConcurrency] = useState('2')
  const [maxHeight, setMaxHeight] = useState('0')
  const [autoTag, setAutoTag] = useState(false)
  const [rules, setRules] = useState('')

  useEffect(() => {
    if (!settings) return
    setConcurrency(String(settings.concurrency ?? 2))
    setMaxHeight(String(settings.max_height ?? 0))
    setAutoTag(Boolean(settings.auto_tag))
  }, [settings])

  const cookiesPresent = settings?.cookies_present

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">下载</CardTitle>
          <CardDescription>yt-dlp 抓取与并发设置</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="set-conc">并发下载数</Label>
              <Input
                id="set-conc"
                type="number"
                min={1}
                max={8}
                value={concurrency}
                onChange={(e) => setConcurrency(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="set-h">最大高度 (0 = 原始)</Label>
              <Input
                id="set-h"
                type="number"
                min={0}
                value={maxHeight}
                onChange={(e) => setMaxHeight(e.target.value)}
              />
            </div>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm">X 登录 Cookie</Label>
              <p className="text-xs text-muted-foreground">
                用于抓取需要登录的内容
              </p>
            </div>
            <Badge variant={cookiesPresent ? 'secondary' : 'outline'}>
              {cookiesPresent ? '已配置' : '未配置'}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">自动归类</CardTitle>
          <CardDescription>
            下载完成后自动使用模型为推文生成标签
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="set-autotag" className="text-sm">
                启用自动归类
              </Label>
              <p className="text-xs text-muted-foreground">
                新推文入库后立即打标签
              </p>
            </div>
            <Switch
              id="set-autotag"
              checked={autoTag}
              onCheckedChange={setAutoTag}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="set-rules">归类规则</Label>
            <Textarea
              id="set-rules"
              rows={6}
              value={rules}
              onChange={(e) => setRules(e.target.value)}
              placeholder="每行一条规则，例如：包含「Rust」→ 编程"
              className="text-xs"
            />
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Sparkles className="size-3.5" />
              留空则仅依赖模型自动判断
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          className="gap-1.5"
          disabled={busy}
          onClick={() =>
            onSave({
              concurrency: Number(concurrency) || 1,
              max_height: Number(maxHeight) || 0,
              auto_tag: autoTag,
            })
          }
        >
          <Save />
          保存设置
        </Button>
      </div>
    </div>
  )
}
