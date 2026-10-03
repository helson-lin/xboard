import type { Post, PostsPage, Tag } from '@/lib/types'
import { PUBLIC_API_BASE, publicUrl } from './publicBase'

function normalisePost(post: Post): Post {
  const resolve = (url: string | null | undefined) =>
    PUBLIC_API_BASE && url?.startsWith('/') ? publicUrl(url) : url
  const media = (items: Post['media']) => items.map(item => ({ ...item, url: resolve(item.url) ?? '' }))
  return {
    ...post,
    author_avatar: resolve(post.author_avatar),
    poster_url: resolve(post.poster_url),
    media: media(post.media),
    videos: post.videos ? media(post.videos) : undefined,
    images: post.images ? media(post.images) : undefined,
  }
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(publicUrl(path))
  if (!res.ok) {
    throw new Error(`请求失败 (${res.status})`)
  }
  return res.json() as Promise<T>
}

function qs(params: Record<string, string | number | null | undefined>): string {
  const usp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue
    usp.set(k, String(v))
  }
  const s = usp.toString()
  return s ? `?${s}` : ''
}

export interface PublicFilters {
  tag: string | null
  kind: string | null
  q: string
  sort: string
}

export const publicApi = {
  listPosts(filters: PublicFilters, limit = 120, offset = 0) {
    return getJson<PostsPage>(
      `/public/posts${qs({
        tag: filters.tag,
        kind: filters.kind,
        q: filters.q,
        sort: filters.sort,
        limit,
        offset,
      })}`,
    ).then(page => ({ ...page, items: page.items.map(normalisePost) }))
  },
  getPost(id: string) {
    return getJson<Post>(`/public/posts/${encodeURIComponent(id)}`).then(normalisePost)
  },
  tags() {
    return getJson<{ items: Tag[] }>('/public/tags')
  },
}
