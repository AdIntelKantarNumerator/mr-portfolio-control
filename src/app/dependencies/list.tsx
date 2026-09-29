'use client'

/**
 * Dependencies as one filterable list, with a dialog to add one.
 *
 * WHAT WENT
 *
 * Four counter tiles, a graph, a team matrix, a "what has to be true" preamble
 * and a separate register below it. Every one of those was answering a
 * question somebody might have; none was answering the question people
 * actually arrive with, which is "what is waiting on what, and is any of it
 * about to bite". The counters in particular were the page telling you how
 * many rows it had, which is visible from the rows.
 *
 * WHAT THE DATE COLUMN MEANS
 *
 * The required date: when the delivering end has to have landed. A row goes
 * red when that date has passed or when the delivering work's own target is
 * already later than it — and the same judgement marks the delivering work
 * blocked on the board, so the two screens cannot disagree.
 */
import { useActionState, useState } from 'react'
import Link from 'next/link'
import { RecordTable, type Column } from '@/components/records/table'
import { EditEntryButton, type EditContext } from '@/components/records/edit-entry'
import { createDependency, setDependencyStatus, type ActionState } from './actions'

const EMPTY: ActionState = {}

export interface DependencyRow {
  id: string
  from: { label: string; href: string | null }
  to: { label: string; href: string | null }
  kind: string
  status: string
  criticality: string
  owner: string | null
  required: string | null
  /** 'overdue' | 'will-miss' | null — why this is not going to land in time. */
  late: string | null
  description: string | null
}

export interface EndpointOption {
  value: string
  label: string
  group: string
}

/*
 * In workflow order, which is also the order the Status column sorts in. The
 * rank comes from this object's own keys, so there is no second list to drift
 * from it.
 */
const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  at_risk: 'At risk',
  resolved: 'Resolved',
  accepted_risk: 'Accepted risk',
}

const STATUS_RANK = Object.keys(STATUS_LABEL)

/** Worst first, which is what a criticality column is for. */
const CRITICALITY_RANK = ['critical', 'high', 'normal']

const LATE_LABEL: Record<string, string> = {
  overdue: 'Date passed',
  'will-miss': 'Will miss',
}

export function DependencyList({
  rows,
  endpoints,
  people,
  editing,
}: {
  rows: DependencyRow[]
  endpoints: EndpointOption[]
  people: { id: string; name: string }[]
  /** What the edit dialog needs, or null for a reader who cannot write. */
  editing: EditContext | null
}) {
  const [adding, setAdding] = useState(false)

  const columns: Column<DependencyRow>[] = [
    {
      key: 'from',
      label: 'Delivering',
      filter: 'select',
      sort: 'text',
      value: (r) => r.from.label,
      cell: (r) => (r.from.href ? <Link href={r.from.href}>{r.from.label}</Link> : r.from.label),
    },
    {
      key: 'to',
      label: 'Waiting',
      filter: 'select',
      sort: 'text',
      value: (r) => r.to.label,
      cell: (r) => (r.to.href ? <Link href={r.to.href}>{r.to.label}</Link> : r.to.label),
    },
    { key: 'kind', label: 'Kind', filter: 'select', sort: 'text', value: (r) => r.kind },
    {
      key: 'status',
      label: 'Status',
      filter: 'select',
      sort: { kind: 'number', by: (r) => STATUS_RANK.indexOf(r.status) + 1 || null },
      value: (r) => STATUS_LABEL[r.status] ?? r.status,
      cell: (r) => <StatusCell row={r} />,
    },
    {
      key: 'criticality',
      label: 'Criticality',
      filter: 'select',
      sort: { kind: 'number', by: (r) => CRITICALITY_RANK.indexOf(r.criticality) + 1 || null },
      value: (r) => r.criticality,
    },
    {
      key: 'owner',
      label: 'Owner',
      filter: 'select',
      sort: { kind: 'text', by: (r) => r.owner },
      value: (r) => r.owner ?? 'Nobody named',
      className: 'rt-owner',
      cell: (r) => (r.owner ? r.owner : <span className="rt-unknown">Nobody named</span>),
    },
    {
      key: 'required',
      label: 'Required by',
      filter: 'select',
      // On the date, not on the "Date passed / On track / No date" bucket the
      // filter offers. Undated rows go to the bottom either way.
      sort: { kind: 'date', by: (r) => r.required },
      value: (r) => (r.late ? (LATE_LABEL[r.late] ?? 'Late') : r.required ? 'On track' : 'No date'),
      className: 'rt-due',
      cell: (r) =>
        r.required ? (
          <span className={r.late ? 'rt-late' : undefined} title={r.late ? LATE_LABEL[r.late] : undefined}>
            {r.required}
          </span>
        ) : (
          <span className="rt-unknown">No date</span>
        ),
    },
    { key: 'description', label: 'Notes', filter: 'text', sort: 'text', value: (r) => r.description ?? '' },
  ]

  // Last, and unfilterable: it is a control, not a fact about the row.
  if (editing) {
    columns.push({
      key: 'edit',
      label: '',
      className: 'rt-edit',
      value: () => '',
      cell: (r) => (
        <EditEntryButton
          kind="dependency"
          id={r.id}
          ctx={editing}
          label={`${r.from.label} → ${r.to.label}`}
        />
      ),
    })
  }

  return (
    <>
      <RecordTable
        rows={rows}
        columns={columns}
        getId={(r) => r.id}
        empty="Nothing is waiting on anything."
        action={
          <button type="button" className="rt-add" onClick={() => setAdding(true)}>
            Add a dependency
          </button>
        }
        footNote="A row is red when the delivering work will not make the required date — either it has passed, or that work's own target is already later. The same judgement marks it blocked on the board."
      />

      {adding && <AddDialog endpoints={endpoints} people={people} onClose={() => setAdding(false)} />}
    </>
  )
}

/** The status, changeable in place: it is the field that moves most. */
function StatusCell({ row }: { row: DependencyRow }) {
  const [busy, setBusy] = useState(false)
  return (
    <select
      className="rt-status"
      defaultValue={row.status}
      disabled={busy}
      onChange={async (e) => {
        setBusy(true)
        const fd = new FormData()
        fd.set('id', row.id)
        fd.set('status', e.target.value)
        await setDependencyStatus(fd)
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
  endpoints,
  people,
  onClose,
}: {
  endpoints: EndpointOption[]
  people: { id: string; name: string }[]
  onClose: () => void
}) {
  const [state, save, busy] = useActionState(createDependency, EMPTY)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const groups = [...new Set(endpoints.map((e) => e.group))]

  if (state.ok) {
    // Closing on success rather than showing a tick: the new row is on the
    // list behind the dialog, which is a better confirmation than a message.
    queueMicrotask(onClose)
  }

  const picker = (
    id: string,
    name: string,
    value: string,
    set: (v: string) => void,
    externalName: string,
  ) => (
    <>
      <select id={id} name={name} value={value} onChange={(e) => set(e.target.value)} required>
        <option value="">Select…</option>
        <option value="__external__">Something outside the portfolio…</option>
        {groups.map((g) => (
          <optgroup key={g} label={g}>
            {endpoints
              .filter((o) => o.group === g)
              .map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      {value === '__external__' ? (
        <input name={externalName} placeholder="e.g. a vendor data feed" required />
      ) : null}
    </>
  )

  return (
    <div className="modal-scrim" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Add a dependency">
        <div className="modal-head">
          <h3>Add a dependency</h3>
          <button type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <form action={save}>
          <label className="mr-label" htmlFor="dep-from">
            Delivering — what has to land
          </label>
          {picker('dep-from', 'from', from, setFrom, 'fromExternal')}
          {state.fieldErrors?.from ? <p className="mr-said mr-bad">{state.fieldErrors.from}</p> : null}

          <label className="mr-label" htmlFor="dep-to">
            Waiting — what cannot move until it does
          </label>
          {picker('dep-to', 'to', to, setTo, 'toExternal')}
          {state.fieldErrors?.to ? <p className="mr-said mr-bad">{state.fieldErrors.to}</p> : null}

          <label className="mr-label" htmlFor="dep-required">
            Required by — when the delivering end has to have landed
          </label>
          <input id="dep-required" type="date" name="dueDate" />

          <div className="mr-grid">
            <span>
              <label className="mr-label" htmlFor="dep-kind">
                Kind
              </label>
              <select id="dep-kind" name="kind" defaultValue="blocks">
                <option value="blocks">Blocks</option>
                <option value="informs">Informs</option>
                <option value="shares_resource">Shares a resource</option>
                <option value="related">Related</option>
              </select>
            </span>
            <span>
              <label className="mr-label" htmlFor="dep-crit">
                Criticality
              </label>
              <select id="dep-crit" name="criticality" defaultValue="normal">
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </span>
            <span>
              <label className="mr-label" htmlFor="dep-owner">
                Owner
              </label>
              <select id="dep-owner" name="ownerId" defaultValue="">
                <option value="">— nobody named —</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </span>
          </div>

          <label className="mr-label" htmlFor="dep-note">
            Notes
          </label>
          <input id="dep-note" name="description" placeholder="what was agreed, and where" />

          <div className="mr-row">
            <button type="submit" className="mr-go" disabled={busy}>
              {busy ? 'Adding…' : 'Add'}
            </button>
            {state.fieldErrors?.form ? <span className="mr-said mr-bad">{state.fieldErrors.form}</span> : null}
          </div>
        </form>
      </div>
    </div>
  )
}
