import { useEffect, useState } from 'react'
import {
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  RefreshCw,
  Save,
  Sparkles,
} from 'lucide-react'

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
import { api } from '@/lib/api'
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
  const [pluginToken, setPluginToken] = useState('')
  const [tokenVisible, setTokenVisible] = useState(false)
  const [tokenLoading, setTokenLoading] = useState(true)
  const [tokenRotating, setTokenRotating] = useState(false)
  const [tokenCopied, setTokenCopied] = useState(false)

  useEffect(() => {
    if (!settings) return
    setConcurrency(String(settings.concurrency ?? 2))
    setMaxHeight(String(settings.max_height ?? 0))
    setAutoTag(Boolean(settings.auto_tag))
  }, [settings])

  useEffect(() => {
    let alive = true
    setTokenLoading(true)
    api
      .apiToken()
      .then(({ token }) => {
        if (alive) setPluginToken(token)
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setTokenLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const copyPluginToken = async () => {
    if (!pluginToken) return
    await navigator.clipboard.writeText(pluginToken)
    setTokenCopied(true)
    window.setTimeout(() => setTokenCopied(false), 1800)
  }

  const rotatePluginToken = async () => {
    if (
      !window.confirm(
        '重新生成后，已安装插件中的旧 Token 将立即失效。确定继续？'
      )
    ) {
      return
    }
    setTokenRotating(true)
    try {
      const { token } = await api.rotateApiToken()
      setPluginToken(token)
      setTokenVisible(true)
      setTokenCopied(false)
    } finally {
      setTokenRotating(false)
    }
  }

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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <KeyRound className="size-4" />
            浏览器插件
          </CardTitle>
          <CardDescription>
            从 X 页面一键提交推文链接，使用独立 API Token 认证
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium">XBoard Saver</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                支持 Chrome 与 Edge，下载 ZIP 后解压并加载已解压的扩展程序
              </p>
            </div>
            <Button asChild variant="outline" className="shrink-0 gap-1.5">
              <a href={api.pluginDownloadUrl()} download>
                <Download />
                下载插件
              </a>
            </Button>
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="plugin-api-token">插件 API Token</Label>
              <span className="text-xs text-muted-foreground">
                请勿分享给不可信的人
              </span>
            </div>
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
              <Input
                id="plugin-api-token"
                type={tokenVisible ? 'text' : 'password'}
                value={tokenLoading ? '正在加载…' : pluginToken}
                readOnly
                className="min-w-0 flex-1 font-mono text-xs"
              />
              <div className="flex shrink-0 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setTokenVisible((visible) => !visible)}
                  disabled={tokenLoading || !pluginToken}
                  aria-label={tokenVisible ? '隐藏 Token' : '显示 Token'}
                  title={tokenVisible ? '隐藏 Token' : '显示 Token'}
                >
                  {tokenVisible ? <EyeOff /> : <Eye />}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => void copyPluginToken()}
                  disabled={tokenLoading || !pluginToken}
                >
                  {tokenCopied ? <Check /> : <Copy />}
                  {tokenCopied ? '已复制' : '复制'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => void rotatePluginToken()}
                  disabled={tokenLoading || tokenRotating}
                >
                  <RefreshCw className={tokenRotating ? 'animate-spin' : undefined} />
                  重新生成
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              插件服务器地址填写当前 XBoard 站点地址；重新生成会使旧 Token 立即失效。
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
