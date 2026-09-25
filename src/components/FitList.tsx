/**
 * R47: a list that never scrolls. It shows only the items that fit its
 * height, then a "more" line ("and N earlier", "and N more"). Used by the
 * table's log and by home's case list. Each rendered item must be an <li>.
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * A list that shows only the items that fit its height (R47), then a "more"
 * line. It renders everything once, measures, and keeps what fits; a new item
 * or a new height measures again.
 */
export function FitList({
  count,
  render,
  more,
  className,
}: {
  count: number
  render: (index: number) => ReactNode
  more: (hidden: number) => ReactNode
  className?: string
}) {
  const box = useRef<HTMLOListElement>(null)
  const [shown, setShown] = useState<number | null>(null)
  const [height, setHeight] = useState(0)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const observer = new ResizeObserver(() => setHeight(el.clientHeight))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => setShown(null), [count, height])
  useLayoutEffect(() => {
    const el = box.current
    if (shown !== null || !el) return
    const top = el.getBoundingClientRect().top
    const items = Array.from(el.querySelectorAll<HTMLElement>(':scope > li'))
    const fits = (limit: number) => items.filter((li) => li.getBoundingClientRect().bottom - top <= limit).length
    const all = fits(el.clientHeight)
    // Room for the "and N earlier" line when not everything fits.
    setShown(all === items.length ? all : fits(el.clientHeight - 22))
  }, [shown])

  const n = shown ?? count
  return (
    <ol ref={box} className={cn('flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden', className)}>
      {Array.from({ length: n }, (_, i) => render(i))}
      {shown !== null && shown < count && <li className="list-none">{more(count - shown)}</li>}
    </ol>
  )
}

