import { useEffect, useRef, type ReactNode } from 'react'

const ROW_HEIGHT = 8
const GAP = 16

/**
 * 瀑布流：CSS grid 每行 8px，测量每张卡片真实高度后设置 grid-row-end，
 * 短卡不再被拉高，也不会像 multi-column 那样留下空列。
 * 子元素必须是可测量的普通元素（这里就是 <article>）。
 */
export function MasonryGrid({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    let frame = 0
    const layout = () => {
      frame = 0
      const items = Array.from(el.children) as HTMLElement[]
      for (const item of items) item.style.gridRowEnd = 'span 1'
      for (const item of items) {
        const height = item.getBoundingClientRect().height
        const span = Math.max(1, Math.ceil((height + GAP) / (ROW_HEIGHT + GAP)))
        item.style.gridRowEnd = `span ${span}`
      }
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(layout)
    }

    schedule()
    const observer = new ResizeObserver(schedule)
    observer.observe(el)
    for (const item of Array.from(el.children)) observer.observe(item)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [children])

  return (
    <div
      ref={ref}
      className={className}
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 20rem), 1fr))',
        gridAutoRows: `${ROW_HEIGHT}px`,
        gap: `${GAP}px`,
        alignItems: 'start',
      }}
    >
      {children}
    </div>
  )
}
