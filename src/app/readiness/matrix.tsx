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
import { useMemo, useState } from 'react'
import { nextStatus, useReadinessBoard, type ReadinessBoard } from '@/components/readiness-toggle'
import Link from 'next/link'
import {} from './actions'


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
  /*
   * The open dialog is held as IDS, not as the row and gate objects.
   *
   * Holding the objects froze them at the moment the cell was clicked. Ticking
   * an item off refreshed the page's data underneath, but the dialog went on
   * rendering the snapshot — so each checkbox's server value stayed whatever
   * it had been when the dialog opened, and the tick reverted the moment its
   * save completed. Looking the row up by id every render means the refreshed
   * data reaches the checkboxes, which is the whole point of refreshing it.
   */
  const [openAt, setOpenAt] = useState<{ rowId: string; gateId: string } | null>(null)
  const board = useReadinessBoard()

  const shown = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!find || r.name.toLowerCase().includes(find.toLowerCase())) && (!status || r.status === status),
      ),
    [rows, find, status],
  )

  // From the unfiltered rows, so typing in the filter box does not shut a
  // dialog the reader has open.
  const openRow = openAt ? (rows.find((r) => r.id === openAt.rowId) ?? null) : null
  const openGate = openAt ? (gates.find((g) => g.id === openAt.gateId) ?? null) : null

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
                          onClick={() => setOpenAt({ rowId: r.id, gateId: g.id })}
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

      {openRow && openGate && (
        <GateDialog row={openRow} gate={openGate} onClose={() => setOpenAt(null)} board={board} />
      )}
    </>
  )
}

function GateDialog({
  row,
  gate,
  onClose,
  board,
}: {
  row: MatrixRow
  gate: GateHead
  onClose: () => void
  board: ReadinessBoard
}) {
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
                <ItemToggle key={item.itemId} item={item} board={board} />
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
function ItemToggle({ item, board }: { item: ItemCell; board: ReadinessBoard }) {
  // The board belongs to the matrix, which stays mounted; this row and the
  // dialog around it do not. See components/readiness-toggle.ts.
  const status = board.statusOf(item.workstreamId, item.itemId, item.status)
  const pending = board.savingOf(item.workstreamId, item.itemId)
  const error = board.errorOf(item.workstreamId, item.itemId)
  const set = (next: string) => board.set(item.workstreamId, item.itemId, item.status, next)

  const done = status === 'done'
  const na = status === 'na'

  return (
    <li className={pending ? 'rx-busy' : undefined}>
      <button
        type="button"
        className={`rx-box${done ? ' on' : ''}`}
        onClick={() => set(nextStatus(status, 'done'))}
        aria-label={done ? `Mark ${item.label} not started` : `Mark ${item.label} done`}
        aria-pressed={done}
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
        onClick={() => set(nextStatus(status, 'na'))}
        aria-pressed={na}
        title="Does not apply to this work"
      >
        N/A
      </button>
      {error ? <em className="rx-err">{error}</em> : null}
    </li>
  )
}
