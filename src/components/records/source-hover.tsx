'use client'

/**
 * Hover an entry and see where it came from.
 *
 * WHY A POPOVER RATHER THAN A `title`
 *
 * The browser's own tooltip would have been one attribute. It takes about a
 * second to appear, cannot hold a link, wraps wherever it likes, and cannot be
 * styled — and what we have to show is a meeting name, a date, a person, a
 * quote and often a link to the document. A `title` is still set alongside, as
 * the fallback for anything that cannot run this.
 *
 * WHY THE POPOVER API RATHER THAN AN ABSOLUTELY POSITIONED DIV
 *
 * `.rt-wrap` has `overflow: hidden` so the table can have rounded corners, and
 * anything positioned inside a row is clipped by it. A popover renders in the
 * top layer, outside the table's box entirely, so there is no clipping and no
 * z-index to lose. Where the API is missing the card simply never opens and
 * the `title` does the job.
 *
 * WHY IT DOES NOT VANISH THE MOMENT YOU MOVE TOWARDS IT
 *
 * The card holds a link to the source document, which is the most useful thing
 * on it. A card that closes on mouseleave is a link you cannot reach. It stays
 * for a moment after the pointer leaves, and stays open while the pointer is
 * over the card itself.
 */
import { useEffect, useId, useRef, useState } from 'react'
import { hostOf, provenanceLine, type Provenance } from '@/lib/provenance'

/** How long the card survives the pointer leaving, in ms. */
const GRACE = 180

export function SourceHover({
  source,
  children,
}: {
  source: Provenance
  children: React.ReactNode
}) {
  const id = useId()
  const host = useRef<HTMLSpanElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const el = card.current
    if (!el || typeof el.showPopover !== 'function') return
    try {
      if (open) {
        place(host.current, el)
        el.showPopover()
      } else if (el.matches(':popover-open')) {
        el.hidePopover()
      }
    } catch {
      // A popover that refuses to open is not worth failing a page over; the
      // title attribute still answers the question.
    }
  }, [open])

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])

  const show = () => {
    if (timer.current) clearTimeout(timer.current)
    setOpen(true)
  }
  const hide = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(false), GRACE)
  }

  return (
    <>
      <span
        ref={host}
        className="src-host"
        tabIndex={0}
        aria-describedby={id}
        title={provenanceLine(source)}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
      >
        {children}
      </span>

      <div
        ref={card}
        id={id}
        // 'manual' rather than 'auto': an auto popover closes as soon as
        // another one opens, and a table of forty rows opens one per row as
        // the pointer travels down it.
        popover="manual"
        role="tooltip"
        className="src-card"
        onMouseEnter={show}
        onMouseLeave={hide}
      >
        <Body source={source} />
      </div>
    </>
  )
}

function Body({ source }: { source: Provenance }) {
  if (source.unattributed) {
    return (
      <p className="src-none">
        No source recorded. Yaara attributes what she reads out of a document; an entry added by hand
        here has nothing to point at.
      </p>
    )
  }

  return (
    <>
      <p className="src-head">
        {source.medium ? <span className="src-kind">{source.medium}</span> : null}
        {source.enteredHere ? 'Added on this page' : source.where}
      </p>

      <p className="src-meta">
        {[source.when, source.who].filter(Boolean).join(' · ') || 'No date recorded'}
      </p>

      {source.url ? (
        <p className="src-link">
          <a href={source.url} target="_blank" rel="noreferrer">
            {hostOf(source.url)} →
          </a>
        </p>
      ) : null}

      {source.later.length > 0 ? (
        <div className="src-more">
          {/* The count first, because "mentioned four times since" is the
              thing that changes how you read the row. */}
          <p className="src-count">
            Mentioned {source.later.length + 1} times
          </p>
          {source.later.slice(0, 3).map((m, i) => (
            <p key={i} className="src-mention">
              <b>{m.when ?? '—'}</b> {m.where ?? m.kind}
              {m.note ? <span className="src-quote">{m.note}</span> : null}
            </p>
          ))}
        </div>
      ) : null}

      {source.closed ? (
        <p className="src-closed">
          Closed {[source.closed.when, source.closed.where].filter(Boolean).join(' · ')}
        </p>
      ) : null}
    </>
  )
}

/**
 * Put the card under the cell, and above it near the foot of the window.
 *
 * Done here rather than with anchor positioning because the popover is in the
 * top layer, so it is positioned against the viewport and the sums are three
 * lines. Written straight to style rather than through state: this runs on
 * every open, and a re-render per pointer move down a table is a cost with
 * nothing to show for it.
 */
function place(host: HTMLElement | null, card: HTMLElement) {
  if (!host) return
  const r = host.getBoundingClientRect()
  const width = Math.min(360, window.innerWidth - 24)
  card.style.width = `${width}px`

  const left = Math.max(12, Math.min(r.left, window.innerWidth - width - 12))
  card.style.left = `${left}px`

  // Measured after the width is set, since the height depends on it.
  card.style.top = '-9999px'
  card.style.display = 'block'
  const height = card.offsetHeight || 160
  const below = r.bottom + 8
  card.style.top = `${below + height > window.innerHeight - 12 ? Math.max(12, r.top - height - 8) : below}px`
  card.style.display = ''
}
