'use client'

/**
 * Action items as one list with columns.
 *
 * WHAT CHANGED AND WHY
 *
 * It was a stack of cards. A card is the right shape for something you read
 * one of; this is something you scan forty of looking for yours, and the
 * question people actually arrive with is "what is outstanding on the GPC
 * objective" or "what does Priya owe". Neither of those is answerable by
 * reading cards in a fixed order.
 *
 * So: one row per commitment, the three levels of work it belongs to as their
 * own filterable columns, the owner in bold because it is what most people are
 * looking for, and the date in red when it has passed.
 *
 * WHY "UNKNOWN" IS SHOWN RATHER THAN LEFT BLANK
 *
 * A commitment nobody tied to an initiative is a fact about the commitment, and
 * one worth being able to filter for. An empty cell reads as a rendering bug;
 * an italic "Unknown" reads as what it is, and it is clickable.
 */
import { TIER_LABEL } from '@/lib/home-types'
import { useActionState, useState } from 'react'
import Link from 'next/link'
import { RecordTable, type Column } from '@/components/records/table'
import { SourceHover } from '@/components/records/source-hover'
import type { Provenance } from '@/lib/provenance'
import { AssignCell } from '@/components/records/assign'
import { assignAction, claimAction, setActionStatus, type ActionState } from './actions'

const EMPTY: ActionState = {}

export interface ActionRowView {
  id: string
  ref: string | null
  text: string
  ownerId: string | null
  owner: string | null
  due: string | null
  overdue: boolean
  status: string
  objective: { id: string; name: string } | null
  initiative: { id: string; name: string } | null
  project: { id: string; name: string } | null
  /** Where this was said, for the hover card. */
  source: Provenance
}

export interface Named {
  id: string
  name: string
}

export function ActionsList({
  rows,
  people,
  objectives,
  initiatives,
  projects,
  closed,
  scope,
}: {
  rows: ActionRowView[]
  people: Named[]
  objectives: Named[]
  initiatives: Named[]
  projects: Named[]
  closed: boolean
  /** Set when a home card linked here for one piece of work. */
  scope: { label: string; clear: string; param: string } | null
}) {
  const [editing, setEditing] = useState<ActionRowView | null>(null)

  const level = (
    row: ActionRowView,
    key: 'objective' | 'initiative' | 'project',
    options: Named[],
  ) => (
    <AssignCell
      value={row[key]?.id ?? ''}
      name={row[key]?.name ?? null}
      options={options}
      onPick={(entityId) => assignAction(row.id, key, entityId)}
    />
  )

  const columns: Column<ActionRowView>[] = [
    {
      key: 'objective',
      label: TIER_LABEL.objective,
      filter: 'select',
      // On the name, so the rows nobody placed go to the bottom in both
      // directions rather than sorting under U for "Unknown".
      sort: { kind: 'text', by: (r) => r.objective?.name },
      value: (r) => r.objective?.name ?? 'Unknown',
      cell: (r) => level(r, 'objective', objectives),
    },
    {
      key: 'initiative',
      label: 'Initiative',
      filter: 'select',
      // On the name, so the rows nobody placed go to the bottom in both
      // directions rather than sorting under U for "Unknown".
      sort: { kind: 'text', by: (r) => r.initiative?.name },
      value: (r) => r.initiative?.name ?? 'Unknown',
      cell: (r) => level(r, 'initiative', initiatives),
    },
    {
      key: 'project',
      label: 'Project',
      filter: 'select',
      // On the name, so the rows nobody placed go to the bottom in both
      // directions rather than sorting under U for "Unknown".
      sort: { kind: 'text', by: (r) => r.project?.name },
      value: (r) => r.project?.name ?? 'Unknown',
      cell: (r) => level(r, 'project', projects),
    },
    {
      key: 'owner',
      label: 'Owner',
      filter: 'select',
      // On the name, so an unowned row goes to the bottom rather than sorting
      // under N for "Nobody named".
      sort: { kind: 'text', by: (r) => r.owner },
      value: (r) => r.owner ?? 'Nobody named',
      className: 'rt-owner',
      cell: (r) => (r.owner ? r.owner : <span className="rt-unknown">Nobody named</span>),
    },
    {
      key: 'due',
      label: 'Due',
      filter: 'select',
      // The column Scott asked for by name. Sorts on the date, not on the
      // three buckets the filter offers.
      sort: { kind: 'date', by: (r) => r.due },
      // Grouped for the filter rather than offering forty individual dates,
      // which is a filter nobody can use.
      value: (r) => (r.overdue ? 'Past due' : r.due ? 'Dated' : 'Unknown'),
      className: 'rt-due',
      cell: (r) =>
        r.due ? (
          <span className={r.overdue ? 'rt-late' : undefined}>{r.due}</span>
        ) : (
          <span className="rt-unknown">Unknown</span>
        ),
    },
    {
      key: 'text',
      label: 'What was said',
      filter: 'text',
      // By reference, which is the order they were raised in — sorting forty
      // commitments by their first word is no use to anybody.
      sort: { kind: 'text', by: (r) => r.ref },
      value: (r) => `${r.ref ?? ''} ${r.text}`,
      cell: (r) => (
        <SourceHover source={r.source}>
          {r.ref ? <span className="rt-ref">{r.ref}</span> : null}
          {r.text}
        </SourceHover>
      ),
    },
    {
      key: 'do',
      label: '',
      value: () => '',
      className: 'rt-right',
      cell: (r) => <RowControls row={r} onEdit={() => setEditing(r)} closed={closed} />,
    },
  ]

  return (
    <>
      <RecordTable
        rows={rows}
        columns={columns}
        getId={(r) => r.id}
        empty={
          closed
            ? 'Nothing has been closed or dropped yet.'
            : 'Nothing outstanding. Yaara writes these out of the meeting notes she reads — if a meeting produced commitments and none are here, check whether she has the document.'
        }
        action={
          <span className="rt-actions">
            {scope ? (
              <span className="rt-scope">
                {scope.label}
                <a href={scope.clear} title="Show everything">
                  ×
                </a>
              </span>
            ) : null}
            <Link className="rt-add" href={toggleHref(closed, scope?.param)}>
              {closed ? 'Show open' : 'Show closed and dropped'}
            </Link>
          </span>
        }
      />

      {editing && (
        <EditDialog row={editing} people={people} onClose={() => setEditing(null)} />
      )}
    </>
  )
}

function RowControls({
  row,
  onEdit,
  closed,
}: {
  row: ActionRowView
  onEdit: () => void
  closed: boolean
}) {
  const [state, act, busy] = useActionState(setActionStatus, EMPTY)
  return (
    <span className="rt-do">
      <form action={act}>
        <input type="hidden" name="id" value={row.id} />
        <input type="hidden" name="status" value={closed ? 'open' : 'done'} />
        <button type="submit" disabled={busy} title={state.error ?? undefined}>
          {closed ? 'Reopen' : 'Done'}
        </button>
      </form>
      <button type="button" onClick={onEdit}>
        Edit
      </button>
    </span>
  )
}

/** Owner and date, the two things Yaara cannot read off notes that name neither. */
function EditDialog({
  row,
  people,
  onClose,
}: {
  row: ActionRowView
  people: Named[]
  onClose: () => void
}) {
  const [state, save, busy] = useActionState(claimAction, EMPTY)

  return (
    <div className="modal-scrim" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Edit action item">
        <div className="modal-head">
          <h3>Owner and date</h3>
          <button type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <p className="mr-lead">{row.text}</p>

        <form action={save}>
          <input type="hidden" name="id" value={row.id} />

          <label className="mr-label" htmlFor="ai-owner">
            Owner
          </label>
          <select id="ai-owner" name="ownerId" defaultValue={row.ownerId ?? ''}>
            <option value="">— nobody named —</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <label className="mr-label" htmlFor="ai-due">
            Due
          </label>
          <input id="ai-due" type="date" name="dueDate" defaultValue={row.due ?? ''} />

          <div className="mr-row">
            <button type="submit" className="mr-go" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            {state.error ? <span className="mr-said mr-bad">{state.error}</span> : null}
            {state.ok ? <span className="mr-hint">{state.message}</span> : null}
          </div>
        </form>
      </div>
    </div>
  )
}

/** The open/closed toggle, carrying any narrowing with it. */
function toggleHref(closed: boolean, scope: string | undefined): string {
  const params = new URLSearchParams()
  if (!closed) params.set('show', 'closed')
  if (scope) params.set('scope', scope)
  const q = params.toString()
  return q ? `/actions?${q}` : '/actions'
}
