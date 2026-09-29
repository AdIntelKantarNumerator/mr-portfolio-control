'use client'

/**
 * The plan for one objective, initiative or project, editable in place.
 *
 * It sits at the top of the detail page because it is the question everybody
 * arrives with: what is this thing supposed to deliver, and by when. Below it
 * the page answers "and what has been happening", which is only interesting
 * once you know what it is measured against.
 *
 * WHAT THE "SYNCED" MARK MEANS
 *
 * Most milestones come from Linear or from a program review deck. Editing one
 * here does not cut it off from its source: the field you changed becomes
 * yours and the sync keeps updating the rest. The row says which fields are
 * held, because "why didn't my Linear change come through" is otherwise an
 * unanswerable question.
 */
import Link from 'next/link'
import { useActionState, useState } from 'react'
import { deleteMilestone, saveMilestone, type MilestoneState } from '@/app/milestone-actions'
import { LocalTime } from './local-time'
import { calendarDate } from '@/lib/calendar-date'
import { byTargetDateText, pageOf } from '@/lib/milestone-order'
import { IconMilestone } from './detail/icons'

const EMPTY: MilestoneState = {}

const STATUS = ['planning', 'on_track', 'at_risk', 'blocked', 'complete'] as const

const STATUS_LABEL: Record<string, string> = {
  planning: 'Planning',
  on_track: 'On track',
  at_risk: 'At risk',
  blocked: 'Blocked',
  complete: 'Complete',
}

const STATUS_COLOR: Record<string, string> = {
  planning: 'var(--line-2)',
  on_track: 'var(--c5)',
  at_risk: 'var(--c2)',
  blocked: 'var(--c3)',
  complete: 'var(--c1)',
}

export interface MilestoneRow {
  id: string
  name: string
  details: string | null
  status: string
  targetLabel: string | null
  /** ISO date, or null. */
  targetDate: string | null
  dependencies: string | null
  contested: boolean
  /** Comma-separated field names a person has set. */
  editedFields: string | null
  editedBy: string | null
  /** ISO. */
  editedAt: string | null
  authoredBy: string | null
  /** Which entity actually owns this row - what an edit is posted against. */
  ownerLevel: 'objective' | 'initiative' | 'project'
  ownerId: string
  /** Set only when the row was borrowed from beneath. Null on the page's own. */
  from: { level: 'objective' | 'initiative' | 'project'; id: string; name: string } | null
}

/** How many milestones a tile shows before it pages. */
const PER_PAGE = 6

export function MilestoneEditor({
  level,
  entityId,
  milestones,
}: {
  level: 'objective' | 'initiative' | 'project'
  entityId: string
  milestones: MilestoneRow[]
}) {
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [page, setPage] = useState(0)
  const borrowed = milestones.filter((m) => m.from).length

  /*
   * By date, soonest first, undated last — not the hand order the editor used
   * to keep. A milestone list read top to bottom is a reading of time, and one
   * arranged by hand claims a sequence the dates do not support. The rule is
   * the one the home rail uses; see lib/milestone-order.ts.
   */
  const ordered = byTargetDateText(milestones)
  const shown = pageOf(ordered, page, PER_PAGE)

  return (
    <section className="ms-panel">
      <div className="ms-head">
        <IconMilestone />
        <h2>Milestones</h2>
        <span className="muted">
          {milestones.length === 0
            ? 'Nothing committed yet'
            : borrowed === 0
              ? `${milestones.length} on this ${level}`
              : `${milestones.length} in scope \u2014 ${milestones.length - borrowed} on this ${level}, ${borrowed} from beneath`}
        </span>
        <button type="button" className="ms-add" onClick={() => setAdding(!adding)}>
          {adding ? 'Cancel' : 'Add a milestone'}
        </button>
      </div>

      {adding && (
        <MilestoneForm
          level={level}
          entityId={entityId}
          onDone={() => setAdding(false)}
        />
      )}

      {milestones.length === 0 && !adding ? (
        <p className="ms-empty">
          Nothing is recorded against this {level}.{' '}
          {level === 'objective'
            ? 'Nothing upstream knows what an objective is committed to — the grouping only exists here, so this is the only place it can be said.'
            : 'Linear and program review decks write these, and you can add or correct them here.'}
        </p>
      ) : (
        <ul className="ms-list">
          {shown.rows.map((m) => {
            const held = (m.editedFields ?? '').split(',').filter(Boolean)
            return (
              <li key={m.id}>
                {/* The row is a flex line rather than one big button, because
                    the source has to be a link and a link inside a button is
                    invalid markup that browsers render unclickable. */}
                <div className="ms-line">
                <button type="button" className="ms-row" onClick={() => setOpen(open === m.id ? null : m.id)}>
                  <i style={{ background: STATUS_COLOR[m.status] ?? 'var(--line-2)' }} />
                  <span className="n">{m.name}</span>
                  <span className="s">{STATUS_LABEL[m.status] ?? m.status}</span>
                  <span className="d">
                    {m.targetLabel ?? (m.targetDate ? calendarDate(m.targetDate) : 'no date')}
                    {m.contested ? ' · contested' : ''}
                  </span>

                  {held.length > 0 && (
                    <span className="e" title={`Held here, not overwritten by a sync: ${held.join(', ')}`}>
                      edited
                    </span>
                  )}
                </button>
                <span className="f">
                  {m.from ? (
                    <Link href={`/${m.from.level}s/${m.from.id}`}>{m.from.name}</Link>
                  ) : (
                    <em className="own">this {level}</em>
                  )}
                </span>
                </div>
                {open === m.id && (
                  // Posted against the entity that owns the row, not the page
                  // being viewed: a project's milestone edited from the
                  // initiative page is still the project's milestone.
                  <MilestoneForm
                    level={m.ownerLevel}
                    entityId={m.ownerId}
                    row={m}
                    onDone={() => setOpen(null)}
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}

      {shown.pages > 1 && (
        /* A tile is a glance, and twenty milestones in one is a page in
           disguise. Six at a time, in date order, with the range said out
           loud so nobody has to count rows to know where they are. */
        <div className="ms-pager">
          <button type="button" onClick={() => setPage(shown.page - 1)} disabled={shown.page === 0}>
            ← Earlier
          </button>
          <span>
            {shown.from + 1}–{shown.to} of {ordered.length}
          </span>
          <button
            type="button"
            onClick={() => setPage(shown.page + 1)}
            disabled={shown.page >= shown.pages - 1}
          >
            Later →
          </button>
        </div>
      )}
    </section>
  )
}

function MilestoneForm({
  level,
  entityId,
  row,
  onDone,
}: {
  level: string
  entityId: string
  row?: MilestoneRow
  onDone: () => void
}) {
  const [saved, save, saving] = useActionState(saveMilestone, EMPTY)
  const [removed, remove, removing] = useActionState(deleteMilestone, EMPTY)
  const state = saved.error || saved.ok ? saved : removed
  const busy = saving || removing

  // The row is gone from the next render once either lands; until then the
  // message is the only feedback, so it stays.
  const done = Boolean(saved.ok || removed.ok)
  if (done && !busy) {
    // Collapsing on the next tick rather than during render: calling the
    // parent's setState here would be a render-phase update of another
    // component, which React refuses.
    queueMicrotask(onDone)
  }

  const held = new Set((row?.editedFields ?? '').split(',').filter(Boolean))

  return (
    <form action={save} className="ms-form">
      <input type="hidden" name="level" value={level} />
      <input type="hidden" name="entityId" value={entityId} />
      {row && <input type="hidden" name="id" value={row.id} />}

      <div className="ms-grid">
        <label className="wide">
          <span>Milestone</span>
          <input name="name" defaultValue={row?.name ?? ''} required minLength={2} maxLength={200} />
        </label>
        <label>
          <span>Status</span>
          <select name="status" defaultValue={row?.status ?? 'planning'}>
            {STATUS.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Date{held.has('targetDate') ? ' · held' : ''}</span>
          <input type="date" name="targetDate" defaultValue={row?.targetDate?.slice(0, 10) ?? ''} />
        </label>
        <label>
          <span>Or as the room says it</span>
          <input name="targetLabel" defaultValue={row?.targetLabel ?? ''} maxLength={80} placeholder="Q3/Q4, TBD/Sep" />
        </label>
        <label className="wide">
          <span>What it is</span>
          <input name="details" defaultValue={row?.details ?? ''} maxLength={1000} />
        </label>
        <label className="wide">
          <span>Depends on</span>
          <input name="dependencies" defaultValue={row?.dependencies ?? ''} maxLength={1000} />
        </label>
        <label className="check">
          <input type="checkbox" name="contested" defaultChecked={row?.contested ?? false} />
          <span>The date is contested or externally committed</span>
        </label>
      </div>

      <div className="ms-foot">
        <button type="submit" disabled={busy}>
          {saving ? 'Saving…' : row ? 'Save' : 'Add'}
        </button>
        <button type="button" onClick={onDone} disabled={busy} className="ghost">
          Cancel
        </button>
        {row && (
          <button
            type="submit"
            formAction={remove}
            disabled={busy}
            className="ghost danger"
            name="id"
            value={row.id}
          >
            {removing ? 'Removing…' : 'Remove'}
          </button>
        )}
        {state.error && <span className="err">{state.error}</span>}
        {state.ok && state.message && <span className="ok">{state.message}</span>}
        {row?.editedBy && (
          <span className="muted">
            Edited by {row.editedBy}
            {row.editedAt ? (
              <>
                {' · '}
                <LocalTime at={row.editedAt} show="date" />
              </>
            ) : null}
          </span>
        )}
      </div>
    </form>
  )
}
