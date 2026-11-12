/** Thin typed wrapper over the XBoard backend REST API. */
import { publicUrl } from './publicBase'

import type {
  Author,
  Filters,
  Job,
  Post,
  PostsPage,
  Settings,
  Stats,
  Tag,
} from './types'

const BASE = ''

let onUnauthorized: (() => void) | null = null

/** Register a callback fired whenever any API call returns 401 (session
 *  expired / not authenticated). Used to flip the UI back to the login form. */
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (res.status === 401) {
    onUnauthorized?.()
  }
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      if (body?.detail) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
    } catch {
      /* keep the status line */
    }
    throw new Error(detail)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

function query(params: Record<string, string | number | null | undefined>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue
    sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

export const api = {
  login(username: string, password: string) {
    return request<{ username: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
  },

  logout() {
    return request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' })
  },

  me() {
    return request<{ authenticated: boolean; username?: string }>('/api/auth/me')
  },

  apiToken() {
    return request<{ token: string }>('/api/auth/token')
  },

  rotateApiToken() {
    return request<{ token: string }>('/api/auth/token/rotate', {
      method: 'POST',
    })
  },

  pluginDownloadUrl() {
    return `${BASE}/api/plugin/download`
  },

  listPosts(filters: Filters, limit = 60, offset = 0) {
    return request<PostsPage>(
      `/api/posts${query({
        tag: filters.tag,
        kind: filters.kind,
        q: filters.q,
        author: filters.author,
        sort: filters.sort,
        limit,
        offset,
      })}`,
    )
  },

  getPost(id: string) {
    return request<Post>(`/api/posts/${encodeURIComponent(id)}`)
  },

  /** Direct browser-download URL for all of a post's media (single file or zip). */
  downloadPostUrl(id: string) {
    return `${BASE}/api/posts/${encodeURIComponent(id)}/download`
  },

  updatePost(id: string, patch: { note?: string; tags?: string[] }) {
    return request<Post>(`/api/posts/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
  },

  retagPost(id: string) {
    return request<{ tags: string[] }>(`/api/posts/${encodeURIComponent(id)}/retag`, {
      method: 'POST',
    })
  },

  retagAll() {
    return request<{ retagged: number }>('/api/posts/retag-all', { method: 'POST' })
  },

  deletePost(id: string, deleteFiles = true) {
    return request<{ deleted: string }>(
      `/api/posts/${encodeURIComponent(id)}${query({ delete_files: String(deleteFiles) })}`,
      { method: 'DELETE' },
    )
  },

  bulk(ids: string[], action: 'delete' | 'retag' | 'add_tags', tags?: string[]) {
    return request<{ ok: boolean; affected: number }>('/api/posts/bulk', {
      method: 'POST',
      body: JSON.stringify({ ids, action, tags }),
    })
  },

  download(urls: string[]) {
    return request<{ queued: number; job_ids: string[]; rejected: string[] }>('/api/download', {
      method: 'POST',
      body: JSON.stringify({ urls }),
    })
  },

  listJobs(limit = 30) {
    return request<{ items: Job[] }>(`/api/jobs${query({ limit })}`)
  },

  retryJob(id: string) {
    return request<{ job_id: string }>(`/api/jobs/${encodeURIComponent(id)}/retry`, {
      method: 'POST',
    })
  },

  tags() {
    return request<{ items: Tag[]; untagged: number }>('/api/tags')
  },

  createTag(name: string, color?: string) {
    return request<{ id: number; name: string }>('/api/tags', {
      method: 'POST',
      body: JSON.stringify({ name, color }),
    })
  },

  renameTag(oldName: string, newName: string) {
    return request<{ renamed: [string, string] }>('/api/tags/rename', {
      method: 'POST',
      body: JSON.stringify({ old: oldName, new: newName }),
    })
  },

  deleteTag(id: number) {
    return request<{ deleted: number }>(`/api/tags/${id}`, { method: 'DELETE' })
  },

  authors() {
    return request<{ items: Author[] }>('/api/authors')
  },

  stats() {
    return request<Stats>('/api/stats')
  },

  settings() {
    return request<Settings>('/api/settings')
  },

  saveSettings(patch: Settings) {
    return request<Settings>('/api/settings', {
      method: 'POST',
      body: JSON.stringify(patch),
    })
  },

  rules() {
    return request<{ categories: Record<string, unknown>; [k: string]: unknown }>('/api/rules')
  },

  saveRules(rules: unknown) {
    return request<{ ok: boolean; categories: number }>('/api/rules', {
      method: 'POST',
      body: JSON.stringify({ rules }),
    })
  },
}

/** Trigger a browser download of all of a post's media via a hidden anchor. */
export function triggerDownload(postId: string) {
  const a = document.createElement('a')
  a.href = `${BASE}/api/posts/${encodeURIComponent(postId)}/download`
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/** Trigger a browser download via the public (unauthenticated) endpoint. */
export function triggerPublicDownload(postId: string) {
  const a = document.createElement('a')
  a.href = publicUrl(`/public/posts/${encodeURIComponent(postId)}/download`)
  document.body.appendChild(a)
  a.click()
  a.remove()
}
