import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Post, Tag } from '@/lib/types'

export function PostTagEditor({ post, tags, onSave }: {
  post: Post
  tags: Tag[]
  onSave: (post: Post, tags: string[]) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const add = () => {
    const value = name.trim()
    if (value) setSelected((prev) => [...new Set([...prev, value])])
    setName('')
  }
  if (!editing) return <Button size="sm" variant="outline" onClick={() => {
    setSelected(post.tags ?? []); setError(''); setName(''); setEditing(true)
  }}>修改标签</Button>

  return <div className="space-y-3 rounded-lg border border-border p-3" onKeyDown={(e) => e.stopPropagation()}>
    <p className="text-sm font-medium">修改标签</p>
    <p className="text-xs text-muted-foreground">点击标签选择或移除，也可以输入新标签。清空后保存即为未归类。</p>
    <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto custom-scrollbar">
      {[...new Set([...tags.map((tag) => tag.name), ...selected])].map((tag) => <Button
        key={tag} size="sm" variant={selected.includes(tag) ? 'default' : 'outline'}
        aria-pressed={selected.includes(tag)} disabled={saving}
        onClick={() => setSelected((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag])}
      >{tag}</Button>)}
    </div>
    <div className="flex gap-2">
      <Input aria-label="新标签名称" placeholder="输入新标签" value={name} disabled={saving}
        onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }} />
      <Button variant="outline" disabled={saving || !name.trim()} onClick={add}>添加</Button>
    </div>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    <div className="flex justify-end gap-2">
      <Button variant="outline" size="sm" disabled={saving} onClick={() => setEditing(false)}>取消</Button>
      <Button size="sm" disabled={saving} onClick={async () => {
        setSaving(true); setError('')
        try {
          await onSave(post, [...new Set([...selected, ...[name.trim()].filter(Boolean)])])
          setEditing(false)
        } catch (e) { setError(e instanceof Error ? e.message : '保存失败，请重试') }
        finally { setSaving(false) }
      }}>{saving ? '保存中…' : '保存标签'}</Button>
    </div>
  </div>
}
