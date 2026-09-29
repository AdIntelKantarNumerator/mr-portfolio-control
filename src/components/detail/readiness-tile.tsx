'use client'

/**
 * The kick-off checklist, as four lines you can open.
 *
 * WHY IT ONLY APPEARS WHEN SOMETHING IS OUTSTANDING
 *
 * A checklist that is entirely green is a checklist nobody needs to see. It
 * was taking a third of the page on every workstream that had already done
 * the work, which trained people to scroll past the section — including on
 * the ones where it was red.
 *
 * WHY THE TICK SAVES IMMEDIATELY
 *
 * The old path was a link to another page carrying a form per item. Nobody
 * walks to another screen to tick a box, so the checklist recorded what was
 * true on the day somebody set it up. The link and the note still live on
 * that page, and ticking here leaves both alone.
 */
import Link from 'next/link'
import { useState } from 'react'
import { nextStatus, useReadinessToggle } from '@/components/readiness-toggle'
import { Tile } from './tile'


export interface ReadinessItemView {
  id: string
  label: string
  required: boolean
  done: boolean
  /** The note and link, for the hover. */
  detail?: string
}

export interface ReadinessGateView {
  id: string
  label: string
  items: ReadinessItemView[]
}

function Item({ workstreamId, item }: { workstreamId: string; item: ReadinessItemView }) {
  // Same rule the Readiness page uses — see components/readiness-toggle.ts.
  // This tile used to draw item.done straight from the server, so a click did
  // nothing at all until the page had been round-tripped.
  const { status, pending, error, set } = useReadinessToggle(
    workstreamId,
    item.id,
    item.done ? 'done' : 'not_started',
  )
  const done = status === 'done'

  return (
    <li title={item.detail || undefined} className={pending ? 'rk-busy' : undefined}>
      <button
        type="button"
        className={`rk-box${done ? ' on' : ''}`}
        onClick={() => set(nextStatus(status, 'done'))}
        aria-pressed={done}
        aria-label={done ? `Mark ${item.label} not started` : `Mark ${item.label} done`}
      >
        {done ? (
          <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M2.5 8.5l3.4 3.4 7.6-8" stroke="currentColor" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
      </button>
      <span className={done ? 'done' : undefined}>{item.label}</span>
      {!item.required && <em>optional</em>}
      {error && <em className="err">{error}</em>}
    </li>
  )
}

export function ReadinessTile({
  workstreamId,
  gates,
  href,
}: {
  /** Readiness is recorded per workstream; a project rolls its own up. */
  workstreamId: string
  gates: ReadinessGateView[]
  /** The full page, where links and notes are edited. */
  href: string
}) {
  const [open, setOpen] = useState<string | null>(null)

  const required = gates.flatMap((g) => g.items.filter((i) => i.required))
  const done = required.filter((i) => i.done).length
  const pct = required.length === 0 ? 100 : Math.round((done / required.length) * 100)

  return (
    <Tile
      title="Readiness"
      icon="readiness"
      className="tile-wide"
      right={
        <Link className="tile-link" href={href}>
          Links and notes →
        </Link>
      }
    >
      <div className="rk-bar" title={`${done} of ${required.length} required items done`}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className="rk-count">
        {done} of {required.length} required items done
      </p>

      <ul className="rk-gates">
        {gates.map((g) => {
          const req = g.items.filter((i) => i.required)
          const complete = req.length > 0 && req.every((i) => i.done)
          const left = req.filter((i) => !i.done).length
          return (
            <li key={g.id}>
              <button type="button" className="rk-gate" onClick={() => setOpen(open === g.id ? null : g.id)} aria-expanded={open === g.id}>
                <i style={{ background: complete ? 'var(--c5)' : 'var(--c3)' }} aria-hidden="true" />
                <span>{g.label}</span>
                <em>{complete ? 'complete' : `${left} to go`}</em>
              </button>
              {open === g.id && (
                <ul className="rk-items">
                  {g.items.map((it) => (
                    <Item key={it.id} workstreamId={workstreamId} item={it} />
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </Tile>
  )
}
