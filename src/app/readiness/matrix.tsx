'use client'

/**
 * The readiness matrix, at whichever level you are looking, with the cells
 * you can tick.
 *
 * WHAT WENT
 *
 * Four counter tiles, two explanatory paragraphs, a legend and a roll-up table
 * under the matrix. The counters counted the matrix; the paragraphs explained
 * a rule (N/A counts as satisfied) that the matrix does not depend on anybody
 * remembering; the roll-up answered a second question on a screen that already
 * had one.
 *
 * WHY THE CELL IS THE CONTROL
 *
 * Readiness went stale because marking an item off meant opening a workstream,
 * finding its checklist and coming back. The number you are looking at when
 * you notice it is wrong is the number you should be able to fix, so clicking
 * a cell opens exactly the items behind it and each tick lands immediately.
 *
 * WHY A HIGHER LEVEL SHOWS THE SAME CONTROL
 *
 * Readiness is recorded per workstream — that is where the work is. A project
 * row is the sum of its workstreams, so its popup lists the items of each one
 * beneath it, named. Rolling up a number but not the way to change it would
 * mean seeing the problem at the level where you cannot do anything about it.
 */
import { useActionState, useMemo, useState } from 'react'
import Link from 'next/link'
import { toggleReadinessItem, type ReadinessToggleState } from './actions'

const EMPTY: ReadinessToggleState = {}

export type Level = 'initiative' | 'project' | 'workstream'

export interface ItemCell {
  itemId: string
  label: string
  required: boolean
  status: string
  /** Which workstream this is recorded against — always a workstream. */
  workstreamId: string
  workstreamName: string
}

export interface GateCell {
  done: number
  total: number
  items: ItemCell[]
}

export interface MatrixRow {
  id: string
  name: string
  status: string
  href: string
  /** gateId → the cell. */
  cells: Record<string, GateCell>
  overall: { done: number; total: number }
}

export interface GateHead {
  id: string
  name: string
  phase: string
}

function tone(done: number, total: number): string {
  if (total === 0) return 'none'
  if (done === 0) return 'none'
  if (done === total) return 'good'
  if (done / total >= 0.67) return 'warn'
  return 'crit'
}

export function ReadinessMatrix({
  rows,
  gates,
  level,
  statuses,
}: {
  rows: MatrixRow[]
  gates: GateHead[]
  level: Level
  statuses: string[]
}) {
  const [find, setFind] = useState('')
  const [status, setStatus] = useState('')
  const [open, setOpen] = useState<{ row: MatrixRow; gate: GateHead } | null>(null)

  const shown = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!find || r.name.toLowerCase().includes(find.toLowerCase())) && (!status || r.status === status),
      ),
    [rows, find, status],
  )

  return (
    <>
      <div className="rt-bar">
        <label className="rt-f">
          <span>Showing</span>
          <select
            value={level}
            onChange={(e) => {
              window.location.search = `?level=${e.target.value}`
            }}
          >
            <option value="initiative">Initiatives</option>
            <option value="project">Projects</option>
            <option value="workstream">Workstreams</option>
          </select>
        </label>

        <label className="rt-f">
          <span>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label className="rt-f">
          <span>Find</span>
          <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find…" />
        </label>

        {(find || status) && (
          <button type="button" className="rt-clear" onClick={() => { setFind(''); setStatus('') }}>
            Clear
          </button>
        )}

        <span className="rt-count">{shown.length}</span>
      </div>

      {shown.length === 0 ? (
        <p className="rt-empty">Nothing matches those filters.</p>
      ) : (
        <div className="rt-wrap rx-wrap">
          <table className="rt rx">
            <thead>
              <tr>
                <th className="rx-name">Name</th>
                <th>Status</th>
                {gates.map((g) => (
                  <th key={g.id}>
                    <div>{g.name}</div>
                    <em>{g.phase}</em>
                  </th>
                ))}
                <th>Overall</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td className="rx-name">
                    <Link href={r.href}>{r.name}</Link>
                  </td>
                  <td className="rx-status">{r.status}</td>
                  {gates.map((g) => {
                    const cell = r.cells[g.id] ?? { done: 0, total: 0, items: [] }
                    return (
                      <td key={g.id}>
                        <button
                          type="button"
                          className={`rx-cell rx-${tone(cell.done, cell.total)}`}
                          onClick={() => setOpen({ row: r, gate: g })}
                          title={`${cell.done} of ${cell.total} required items — click to tick them off`}
                          disabled={cell.items.length === 0}
                        >
                          {cell.done}/{cell.total}
                        </button>
                      </td>
                    )
                  })}
                  <td>
                    <span className={`rx-cell rx-flat rx-${tone(r.overall.done, r.overall.total)}`}>
                      {r.overall.done}/{r.overall.total}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && <GateDialog row={open.row} gate={open.gate} onClose={() => setOpen(null)} />}
    </>
  )
}

function GateDialog({ row, gate, onClose }: { row: MatrixRow; gate: GateHead; onClose: () => void }) {
  const cell = row.cells[gate.id] ?? { done: 0, total: 0, items: [] }
  // Grouped by workstream, because at project level the same item name appears
  // several times and an ungrouped list of identical labels is unreadable.
  const groups = useMemo(() => {
    const out = new Map<string, ItemCell[]>()
    for (const item of cell.items) {
      out.set(item.workstreamName, [...(out.get(item.workstreamName) ?? []), item])
    }
    return [...out.entries()]
  }, [cell.items])

  return (
    <div className="modal-scrim" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={`${gate.name} for ${row.name}`}>
        <div className="modal-head">
          <h3>{gate.name}</h3>
          <button type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <p className="mr-from">
          {row.name} · {cell.done} of {cell.total} required
        </p>

        {groups.map(([workstream, items]) => (
          <div key={workstream} className="rx-group">
            {groups.length > 1 ? <h4>{workstream}</h4> : null}
            <ul className="rx-items">
              {items.map((item) => (
                <ItemToggle key={item.itemId} item={item} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * One item, ticked in place.
 *
 * Three states rather than two: N/A is a completed judgement, not an
 * outstanding obligation, and a checklist that only offers done-or-not teaches
 * people to mark things done instead — which is how it stops telling the
 * truth.
 */
function ItemToggle({ item }: { item: ItemCell }) {
  const [state, send, busy] = useActionState(toggleReadinessItem, EMPTY)
  const [shown, setShown] = useState(item.status)

  const set = (status: string) => {
    setShown(status)
    const fd = new FormData()
    fd.set('workstreamId', item.workstreamId)
    fd.set('itemId', item.itemId)
    fd.set('status', status)
    send(fd)
  }

  const done = shown === 'done'
  const na = shown === 'na'

  return (
    <li className={busy ? 'rx-busy' : undefined}>
      <button
        type="button"
        className={`rx-box${done ? ' on' : ''}`}
        onClick={() => set(done ? 'not_started' : 'done')}
        aria-label={done ? `Mark ${item.label} not started` : `Mark ${item.label} done`}
        disabled={busy}
      >
        {done ? '✓' : ''}
      </button>
      <span className={done || na ? 'rx-done' : undefined}>
        {item.label}
        {item.required ? null : <em> optional</em>}
      </span>
      <button
        type="button"
        className={`rx-na${na ? ' on' : ''}`}
        onClick={() => set(na ? 'not_started' : 'na')}
        disabled={busy}
        title="Does not apply to this work"
      >
        N/A
      </button>
      {state.error ? <em className="rx-err">{state.error}</em> : null}
    </li>
  )
}
