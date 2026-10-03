// Public frontend can be hosted separately; admin keeps same-origin cookies.
export const PUBLIC_API_BASE = (import.meta.env.VITE_PUBLIC_API_BASE_URL ?? '').replace(/\/+$/, '')

export function publicUrl(path: string): string {
  return `${PUBLIC_API_BASE}${path}`
}
