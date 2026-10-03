import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'

export interface ImageZoomHandle {
  zoomIn: () => void
  zoomOut: () => void
  reset: () => void
}

type View = { scale: number; x: number; y: number }
const INITIAL: View = { scale: 1, x: 0, y: 0 }

/** Zoom around the cursor, with bounded panning and non-passive wheel handling. */
export function ZoomableImage({ src, ref, onScaleChange }: {
  src: string
  ref?: Ref<ImageZoomHandle>
  onScaleChange: (scale: number) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const img = useRef<HTMLImageElement>(null)
  const viewRef = useRef<View>(INITIAL)
  const drag = useRef<{ id: number; x: number; y: number } | null>(null)
  const [view, setView] = useState<View>(INITIAL)
  const [dragging, setDragging] = useState(false)

  function update(next: View) {
    const box = container.current
    const image = img.current
    if (!box || !image) return
    const limitX = Math.max(0, (image.offsetWidth * next.scale - box.clientWidth) / 2)
    const limitY = Math.max(0, (image.offsetHeight * next.scale - box.clientHeight) / 2)
    next = { ...next, x: Math.max(-limitX, Math.min(limitX, next.x)),
      y: Math.max(-limitY, Math.min(limitY, next.y)) }
    viewRef.current = next
    setView(next)
    onScaleChange(next.scale)
  }

  useImperativeHandle(ref, () => ({
    zoomIn: () => zoom(1.25),
    zoomOut: () => zoom(1 / 1.25),
    reset: () => update(INITIAL),
  }))

  function zoom(factor: number, clientX?: number, clientY?: number) {
    const box = container.current
    if (!box) return
    onScaleChange(1)
    const current = viewRef.current
    const scale = Math.max(1, Math.min(8, current.scale * factor))
    const rect = box.getBoundingClientRect()
    const x = clientX === undefined ? 0 : clientX - rect.left - rect.width / 2
    const y = clientY === undefined ? 0 : clientY - rect.top - rect.height / 2
    const ratio = scale / current.scale
    update({ scale, x: x - (x - current.x) * ratio, y: y - (y - current.y) * ratio })
  }

  useEffect(() => {
    const box = container.current
    if (!box) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? box.clientHeight : 1)
      zoom(Math.exp(-Math.max(-100, Math.min(100, delta)) * 0.002), event.clientX, event.clientY)
    }
    const resize = new ResizeObserver(() => update(viewRef.current))
    resize.observe(box)
    box.addEventListener('wheel', wheel, { passive: false })
    return () => {
      resize.disconnect()
      box.removeEventListener('wheel', wheel)
    }
    // The listener reads current transform and DOM geometry through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div ref={container} data-zoomable-image
      className="relative flex size-full min-h-0 items-center justify-center overflow-hidden"
      style={{ touchAction: view.scale > 1 ? 'none' : 'auto', cursor: view.scale > 1 ? dragging ? 'grabbing' : 'grab' : 'zoom-in' }}
      onDoubleClick={() => update(INITIAL)}
      onPointerDown={(event) => {
        if (viewRef.current.scale <= 1 || event.button !== 0) return
        event.preventDefault()
        event.stopPropagation()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
        setDragging(true)
      }}
      onPointerMove={(event) => {
        const start = drag.current
        if (!start || start.id !== event.pointerId) return
        update({ ...viewRef.current, x: viewRef.current.x + event.clientX - start.x,
          y: viewRef.current.y + event.clientY - start.y })
        drag.current = { id: start.id, x: event.clientX, y: event.clientY }
      }}
      onLostPointerCapture={() => { drag.current = null; setDragging(false) }}
    >
      <img ref={img} src={src} alt="" draggable={false}
        className="block max-h-full max-w-full select-none rounded-lg object-contain shadow-2xl"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }} />
    </div>
  )
}
