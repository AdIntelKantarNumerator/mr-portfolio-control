'use client'

/**
 * A register as one filterable list, with a dialog to add to it.
 *
 * Blockers and decisions are one table and one shape — what differs is the
 * word on the page. They were going to be two copies of this file; the second
 * would have been written the day a Decisions page was needed, and the two
 * would have drifted from the first change onwards. So the words are a
 * parameter and the list is not.
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
import { EditEntryButton, type EditContext } from '@/components/records/edit-entry'
import { createBlocker, fileBlockerAt, setBlockerStatus, type BlockerState } from '@/app/blockers/actions'

const EMPTY: BlockerState = {}

export type RegisterKind = 'blocker' | 'decision'

/** Everything about a register that is a word rather than a behaviour. */
interface Words {
  /** The page's own path, for the open/closed toggle. */
  href: string
  add: string
  adding: string
  added: string
  /** The column that carries the substance. */
  body: string
  titleLabel: string
  bodyLabel: string
  titlePlaceholder: string
  bodyPlaceholder: string
  emptyOpen: string
  emptyClosed: string
  showClosed: string
  showOpen: string
}

const WORDS: Record<RegisterKind, Words> = {
  blocker: {
    href: '/blockers',
    add: 'Raise a blocker',
    adding: 'Raising…',
    added: 'Raise',
    body: 'What is in the way',
    titleLabel: 'What is blocked',
    bodyLabel: 'What is in the way',
    titlePlaceholder: 'Entitlements UI cannot start',
    bodyPlaceholder: 'waiting on the entity rules decision',
    emptyOpen: 'Nothing is blocked.',
    emptyClosed: 'Nothing has been resolved or dropped yet.',
    showClosed: 'Show resolved',
    showOpen: 'Show open',
  },
  decision: {
    href: '/decisions',
    add: 'Record a decision',
    adding: 'Recording…',
    added: 'Record',
    body: 'What has to be decided',
    titleLabel: 'What has to be decided',
    bodyLabel: 'What the options are',
    titlePlaceholder: 'Which identifier wins',
    bodyPlaceholder: 'legacy id, or the new one',
    emptyOpen: 'No decisions outstanding.',
    emptyClosed: 'Nothing has been decided or dropped yet.',
    showClosed: 'Show decided',
    showOpen: 'Show outstanding',
  },
}

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

/*
 * In workflow order, which is also the sort order for the Status column.
 * Taking the rank from this object's own key order means there is no second
 * list to fall out of step with it — and alphabetically "Resolved" would come
 * before "Watching", which is not an order anybody means.
 */
const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  watch: 'Watching',
  decided: 'Resolved',
  dropped: 'Dropped',
}

const STATUS_RANK = Object.keys(STATUS_LABEL)

/** A readable label for a status, including one this list does not know. */
function labelFor(status: string): string {
  return STATUS_LABEL[status] ?? status.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

/** The hierarchy, for the Level column. */
const TIER_RANK = ['initiative', 'project', 'workstream']

export function RegisterList({
  kind,
  rows,
  initiatives,
  projects,
  workstreams,
  people,
  closed,
  editing,
  scope,
}: {
  kind: RegisterKind
  rows: BlockerRow[]
  initiatives: Named[]
  projects: Named[]
  workstreams: Named[]
  people: Named[]
  closed: boolean
  /** What the edit dialog needs, or null for a reader who cannot write. */
  editing: EditContext | null
  /** Set when a card linked here, narrowing the list to one piece of work. */
  scope: { label: string; clear: string; param: string } | null
}) {
  const [adding, setAdding] = useState(false)
  const w = WORDS[kind]

  const optionsFor = (level: string | null) =>
    level === 'initiative' ? initiatives : level === 'project' ? projects : workstreams

  const columns: Column<BlockerRow>[] = [
    { key: 'ref', label: 'Ref', sort: 'text', value: (r) => r.ref, className: 'rt-due' },
    {
      key: 'at',
      label: 'Against',
      filter: 'select',
      sort: { kind: 'text', by: (r) => r.entity?.name },
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
      // Widest first, matching the hierarchy rather than the alphabet.
      sort: { kind: 'number', by: (r) => TIER_RANK.indexOf(r.level ?? '') + 1 || null },
      value: (r) => (r.level ? r.level[0]!.toUpperCase() + r.level.slice(1) : 'Unknown'),
    },
    {
      key: 'status',
      label: 'Status',
      filter: 'select',
      // By the workflow, with anything outside it after the statuses this
      // list does know - see labelFor.
      sort: { kind: 'number', by: (r) => STATUS_RANK.indexOf(r.status) + 1 || null },
      value: (r) => labelFor(r.status),
      cell: (r) => <StatusCell row={r} />,
    },
    { key: 'category', label: 'Category', filter: 'select', sort: 'text', value: (r) => r.category },
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
      key: 'dueBy',
      label: 'Needed by',
      filter: 'select',
      // Free text: mostly dates, sometimes "ASAP". Dates order among
      // themselves and come first — see lib/record-sort.ts.
      sort: { kind: 'date', by: (r) => r.dueBy },
      value: (r) => r.dueBy ?? 'Unknown',
      className: 'rt-due',
      cell: (r) => (r.dueBy ? r.dueBy : <span className="rt-unknown">Unknown</span>),
    },
    {
      key: 'title',
      label: w.body,
      filter: 'text',
      sort: { kind: 'text', by: (r) => r.title },
      value: (r) => `${r.title} ${r.body}`,
      cell: (r) => (
        <>
          <b>{r.title}</b>
          {r.body ? <span className="rt-sub">{r.body}</span> : null}
        </>
      ),
    },
  ]

  // Last, and unfilterable: it is a control, not a fact about the row.
  if (editing) {
    columns.push({
      key: 'edit',
      label: '',
      className: 'rt-edit',
      value: () => '',
      cell: (r) => <EditEntryButton kind="blocker" id={r.id} ctx={editing} label={r.title} />,
    })
  }

  return (
    <>
      <RecordTable
        rows={rows}
        columns={columns}
        getId={(r) => r.id}
        empty={closed ? w.emptyClosed : w.emptyOpen}
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
            <a className="rt-clear" href={toggleHref(w.href, closed, scope?.param)}>
              {closed ? w.showOpen : w.showClosed}
            </a>
            <button type="button" className="rt-add" onClick={() => setAdding(true)}>
              {w.add}
            </button>
          </span>
        }
      />

      {adding && (
        <AddDialog
          kind={kind}
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
      {/*
        * A status outside the vocabulary gets an option of its own rather
        * than being left out. A select whose value matches no option renders
        * the FIRST one, so two blockers carrying at_risk - written by
        * something that does not share this list - sat on the page reading
        * "Open". Showing a row as something it is not is worse than showing
        * an unfamiliar word, and it is silent.
        */}
      {!(row.status in STATUS_LABEL) && row.status ? (
        <option value={row.status}>{labelFor(row.status)}</option>
      ) : null}
      {Object.entries(STATUS_LABEL).map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  )
}

function AddDialog({
  kind,
  initiatives,
  projects,
  workstreams,
  people,
  onClose,
}: {
  kind: RegisterKind
  initiatives: Named[]
  projects: Named[]
  workstreams: Named[]
  people: Named[]
  onClose: () => void
}) {
  const [state, save, busy] = useActionState(createBlocker, EMPTY)
  const w = WORDS[kind]
  if (state.ok) queueMicrotask(onClose)

  return (
    <div className="modal-scrim" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={w.add}>
        <div className="modal-head">
          <h3>{w.add}</h3>
          <button type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <form action={save}>
          <input type="hidden" name="kind" value={kind} />
          <label className="mr-label" htmlFor="b-title">
            {w.titleLabel}
          </label>
          <input id="b-title" name="title" required placeholder={w.titlePlaceholder} />

          <label className="mr-label" htmlFor="b-body">
            {w.bodyLabel}
          </label>
          <input id="b-body" name="body" required placeholder={w.bodyPlaceholder} />

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
              {busy ? w.adding : w.added}
            </button>
            {state.error ? <span className="mr-said mr-bad">{state.error}</span> : null}
          </div>
        </form>
      </div>
    </div>
  )
}

/**
 * The open/closed toggle, carrying any narrowing with it.
 *
 * Dropping the scope here would quietly widen the list at the moment the
 * reader asked only to see the closed ones, which reads as the filter having
 * failed rather than as a second question being answered.
 */
function toggleHref(href: string, closed: boolean, scope: string | undefined): string {
  const params = new URLSearchParams()
  if (!closed) params.set('show', 'closed')
  if (scope) params.set('scope', scope)
  const q = params.toString()
  return q ? `${href}?${q}` : href
}
