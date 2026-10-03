/** Shapes returned by the XBoard FastAPI backend. */

export type MediaKind = 'video' | 'image' | 'text' | 'gif' | string

export interface MediaItem {
  id?: number
  post_id?: string
  kind: MediaKind
  path?: string
  url: string
  mime?: string
  width?: number | null
  height?: number | null
  duration?: number | null
  filesize?: number | null
  position?: number | null
}

export interface Post {
  id: string
  url: string
  author_name?: string | null
  author_handle?: string | null
  author_avatar?: string | null
  author_verified?: number | boolean | null
  text?: string | null
  lang?: string | null
  created_at?: string | null
  favorite_count?: number | null
  reply_count?: number | null
  media_kind?: MediaKind | null
  duration?: number | null
  width?: number | null
  height?: number | null
  poster_path?: string | null
  poster_url?: string | null
  note?: string | null
  status: 'ready' | 'failed' | 'pending' | string
  error?: string | null
  source?: string | null
  tagged_at?: string | null
  added_at?: string | null
  total_size?: number | null
  size_bytes?: number | null
  has_video?: boolean | number | null
  tags: string[]
  media: MediaItem[]
  videos?: MediaItem[]
  images?: MediaItem[]
}

export interface PostsPage {
  items: Post[]
  total: number
  limit: number
  offset: number
}

export interface Tag {
  id: number | null
  name: string
  color?: string | null
  kind?: string | null
  count: number
}

export interface Author {
  author_handle: string
  author_name?: string | null
  author_avatar?: string | null
  count: number
}

export interface Stats {
  posts: number
  ready: number
  failed: number
  videos: number
  images: number
  size: number
  pending_jobs: number
  tags: number
  last_added?: string | null
  disk_free: number
}

export interface Job {
  id: string
  url: string
  status: 'queued' | 'running' | 'done' | 'failed' | string
  stage?: string | null
  error?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export interface Settings {
  [key: string]: unknown
  cookies_present?: boolean
  llm_api_key?: string
  max_height?: number
  concurrency?: number
  auto_tag?: boolean
}

export type SortKey = 'new' | 'old' | 'added' | 'size' | 'duration'

export interface Filters {
  tag: string | null
  kind: string | null
  q: string
  author: string | null
  sort: SortKey
}