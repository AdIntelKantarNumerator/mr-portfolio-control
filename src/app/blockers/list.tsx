'use client'

/**
 * Blockers as one filterable list, with a dialog to raise one.
 *
 * Same shape as Dependencies, deliberately. They are two registers and one
 * question — what is stuck and whose is it — and a reader who has learned one
 * page has learned the other.
 *
 * The level columns are editable in place because the commonest repair on a
 * blocker Yaara read out of a meeting is that it is filed against the wrong
 * piece of work, and the place somebody notices that is this row.
 */
import { useActionState, useState } from 'react'
import { RecordTable, type Column } from '@/components/records/table'
import { AssignCell } from '@/components/records/assign'
import { createBlocker, fileBlockerAt, setBlockerStatus, type BlockerState } from './actions'

const EMPTY: BlockerState = {}

export interface Named {
  id: string
  name: string
}

export interface BlockerRow {
  id: string
  ref: string
  title: string
  body: string
  status: string
  category: string
  owner: string | null
  raisedBy: string | null
  dueBy: string | null
  raisedAt: string | null
  level: string | null
  entity: Named | null
}

const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  watch: 'Watching',
  decided: 'Resolved',
  dropped: 'Dropped',
}

export function BlockerList({
  rows,
  initiatives,
  projects,
  workstreams,
  people,
  closed,
}: {
  rows: BlockerRow[]
  initiatives: Named[]
  projects: Named[]
  workstreams: Named[]
  people: Named[]
  closed: boolean
}) {
  const [adding, setAdding] = useState(false)

  const optionsFor = (level: string | null) =>
    level === 'initiative' ? initiatives : level === 'project' ? projects : workstreams

  const columns: Column<BlockerRow>[] = [
    { key: 'ref', label: 'Ref', value: (r) => r.ref, className: 'rt-due' },
    {
      key: 'at',
      label: 'Against',
      filter: 'select',
      value: (r) => r.entity?.name ?? 'Unknown',
      cell: (r) => (
        <AssignCell
          value={r.entity?.id ?? ''}
          name={r.entity?.name ?? null}
          options={optionsFor(r.level ?? 'workstream')}
          onPick={(entityId) => fileBlockerAt(r.id, r.level ?? 'workstream', entityId)}
        />
      ),
    },
    {
      key: 'level',
      label: 'Level',
      filter: 'select',
      value: (r) => (r.level ? r.level[0]!.toUpperCase() + r.level.slice(1) : 'Unknown'),
    },
    {
      key: 'status',
      label: 'Status',
      filter: 'select',
      value: (r) => STATUS_LABEL[r.status] ?? r.status,
      cell: (r) => <StatusCell row={r} />,
    },
    { key: 'category', label: 'Category', filter: 'select', value: (r) => r.category },
    {
      key: 'owner',
      label: 'Owner',
      filter: 'select',
      value: (r) => r.owner ?? 'Nobody named',
      className: 'rt-owner',
      cell: (r) => (r.owner ? r.owner : <span className="rt-unknown">Nobody named</span>),
    },
    {
      key: 'dueBy',
      label: 'Needed by',
      filter: 'select',
      value: (r) => r.dueBy ?? 'Unknown',
      className: 'rt-due',
      cell: (r) => (r.dueBy ? r.dueBy : <span className="rt-unknown">Unknown</span>),
    },
    {
      key: 'title',
      label: 'What is in the way',
      filter: 'text',
      value: (r) => `${r.title} ${r.body}`,
      cell: (r) => (
        <>
          <b>{r.title}</b>
          {r.body ? <span className="rt-sub">{r.body}</span> : null}
        </>
      ),
    },
  ]

  return (
    <>
      <RecordTable
        rows={rows}
        columns={columns}
        getId={(r) => r.id}
        empty={closed ? 'Nothing has been resolved or dropped yet.' : 'Nothing is blocked.'}
        action={
          <span className="rt-actions">
            <a className="rt-clear" href={closed ? '/blockers' : '/blockers?show=closed'}>
              {closed ? 'Show open' : 'Show resolved'}
            </a>
            <button type="button" className="rt-add" onClick={() => setAdding(true)}>
              Raise a blocker
            </button>
          </span>
        }
      />

      {adding && (
        <AddDialog
          initiatives={initiatives}
          projects={projects}
          workstreams={workstreams}
          people={people}
          onClose={() => setAdding(false)}
        />
      )}
    </>
  )
}

function StatusCell({ row }: { row: BlockerRow }) {
  const [busy, setBusy] = useState(false)
  return (
    <select
      className="rt-status"
      defaultValue={row.status}
      disabled={busy}
      onChange={async (e) => {
        setBusy(true)
        await setBlockerStatus(row.id, e.target.value)
        setBusy(false)
      }}
    >
      {Object.entries(STATUS_LABEL).map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  )
}

function AddDialog({
  initiatives,
  projects,
  workstreams,
  people,
  onClose,
}: {
  initiatives: Named[]
  projects: Named[]
  workstreams: Named[]
  people: Named[]
  onClose: () => void
}) {
  const [state, save, busy] = useActionState(createBlocker, EMPTY)
  if (state.ok) queueMicrotask(onClose)

  return (
    <div className="modal-scrim" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Raise a blocker">
        <div className="modal-head">
          <h3>Raise a blocker</h3>
          <button type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <form action={save}>
          <label className="mr-label" htmlFor="b-title">
            What is blocked
          </label>
          <input id="b-title" name="title" required placeholder="Entitlements UI cannot start" />

          <label className="mr-label" htmlFor="b-body">
            What is in the way
          </label>
          <input id="b-body" name="body" required placeholder="waiting on the entity rules decision" />

          <label className="mr-label" htmlFor="b-at">
            Against
          </label>
          <select id="b-at" name="at" defaultValue="">
            <option value="">— nothing in particular —</option>
            <optgroup label="Initiatives">
              {initiatives.map((o) => (
                <option key={o.id} value={`initiative:${o.id}`}>
                  {o.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Projects">
              {projects.map((o) => (
                <option key={o.id} value={`project:${o.id}`}>
                  {o.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Workstreams">
              {workstreams.map((o) => (
                <option key={o.id} value={`workstream:${o.id}`}>
                  {o.name}
                </option>
              ))}
            </optgroup>
          </select>

          <div className="mr-grid">
            <span>
              <label className="mr-label" htmlFor="b-owner">
                Owner
              </label>
              <select id="b-owner" name="ownerId" defaultValue="">
                <option value="">— nobody named —</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </span>
            <span>
              <label className="mr-label" htmlFor="b-cat">
                Category
              </label>
              <select id="b-cat" name="category" defaultValue="delivery">
                <option value="delivery">Delivery</option>
                <option value="strategic">Strategic</option>
                <option value="risk">Risk</option>
              </select>
            </span>
            <span>
              {/* Free text on purpose: "Next leads", "~7/10", "this week" are
                  what people actually say, and a date picker would make them
                  invent a precision they do not have. */}
              <label className="mr-label" htmlFor="b-due">
                Needed by
              </label>
              <input id="b-due" name="dueBy" placeholder="next leads call" />
            </span>
          </div>

          <div className="mr-row">
            <button type="submit" className="mr-go" disabled={busy}>
              {busy ? 'Raising…' : 'Raise'}
            </button>
            {state.error ? <span className="mr-said mr-bad">{state.error}</span> : null}
          </div>
        </form>
      </div>
    </div>
  )
}
