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
import { nextStatus, useReadinessBoard, type ReadinessBoard } from '@/components/readiness-toggle'
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

/** One workstream's whole checklist, with its required-item count. */
export interface ReadinessStream {
  id: string
  name: string
  gates: ReadinessGateView[]
  done: number
  total: number
}

function Item({
  workstreamId,
  item,
  board,
}: {
  workstreamId: string
  item: ReadinessItemView
  board: ReadinessBoard
}) {
  // The board is held by the tile, not by this row: a row unmounts whenever
  // its section is closed, and an edit held on it would go with it. See
  // components/readiness-toggle.ts.
  const server = item.done ? 'done' : 'not_started'
  const status = board.statusOf(workstreamId, item.id, server)
  const pending = board.savingOf(workstreamId, item.id)
  const error = board.errorOf(workstreamId, item.id)
  const set = (next: string) => board.set(workstreamId, item.id, server, next)
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
  streams,
}: {
  /** Where to start. A checklist belongs to a workstream, never to a project. */
  workstreamId: string
  /** Every workstream this page covers, each with its own checklist. */
  streams: ReadinessStream[]
}) {
  const [open, setOpen] = useState<string | null>(null)
  /*
   * Which workstream is being shown, held HERE.
   *
   * It used to be decided on the server as "the first one with something
   * outstanding", recomputed on every render — so ticking the last box on a
   * project page swapped the tile to a different workstream whose boxes were
   * all empty. Fourteen ticks, and all fourteen appear to undo themselves.
   * Once the reader is looking at a checklist it stays put until they say
   * otherwise.
   */
  const [picked, setPicked] = useState(workstreamId)
  const shown = streams.find((s) => s.id === picked) ?? streams[0]!
  const board = useReadinessBoard()

  const gates = shown.gates
  const required = gates.flatMap((g) => g.items.filter((i) => i.required))
  const done = required.filter((i) => i.done).length
  const pct = required.length === 0 ? 100 : Math.round((done / required.length) * 100)

  return (
    <Tile
      title="Readiness"
      icon="readiness"
      className="tile-wide"
      right={
        <Link className="tile-link" href={`/readiness/${shown.id}`}>
          Links and notes →
        </Link>
      }
    >
      {streams.length > 1 && (
        /* Named, and switchable. A page covering six workstreams showing one
           unlabelled checklist is a checklist you cannot trust: there is no
           way to tell whose it is, or that it is not all of them. */
        <label className="rk-pick">
          <span>Workstream</span>
          <select value={shown.id} onChange={(e) => setPicked(e.target.value)}>
            {streams.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} — {s.done}/{s.total}
              </option>
            ))}
          </select>
        </label>
      )}

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
                    <Item key={it.id} workstreamId={shown.id} item={it} board={board} />
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
