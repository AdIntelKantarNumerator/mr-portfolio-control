'use client'

/**
 * Projects, one row each, with their workstreams underneath.
 *
 * Same shape as the initiatives list on purpose: ring on the left saying how
 * far along against how far along it should be, a coloured edge repeating it
 * for anyone scanning, and the facts that decide anything — who owns it, when
 * it lands, what is underneath — on the row itself rather than a click away.
 *
 * WHY EVERY VALUE HERE IS EDITABLE
 *
 * The owner, the status, the lead, the dates and the health are the fields
 * that go stale, and they go stale because correcting one meant finding the
 * screen that owned it. They are all `<Editable>` now, all writing through
 * the one server action, so the place you notice a wrong value is the place
 * you fix it.
 */
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { SortableRows, SortPicker } from '@/components/sortable-rows'
import { NextMilestoneRing, edgeColor, shortMilestone } from '@/components/ring'
import { Editable } from '@/components/editable'
import { HealthEditable } from '@/components/health-editable'
import { calendarDate } from '@/lib/calendar-date'

export interface WorkstreamRow {
  id: string
  name: string
  status: string
  priority: string | null
  progress: number
  lead: string | null
  startDate: string | null
  targetDate: string | null
  health: { rag: string; rationale: string | null; evidence: string | null; origin: string }
}

export interface ProjectRow {
  id: string
  name: string
  status: string
  owner: string | null
  startDate: string | null
  targetDate: string | null
  /** True when the dates came from the workstreams rather than from anybody. */
  datesRolledUp: boolean
  /** Pace against the next milestone, from the home board. */
  health: 'good' | 'warn' | 'crit' | 'quiet' | null
  /** The project's own assessed health, used for the edge when there is no pace. */
  rag: string | null
  next: { name: string; pct: number; expected: number; due: string | null } | null
  workstreams: WorkstreamRow[]
}

const ENDED = new Set(['completed', 'canceled', 'cancelled', 'withdrawn'])

/**
 * The edge colour for a row nothing has been said about.
 *
 * Deliberately neutral for work that is merely running: green on this app
 * means somebody assessed it and said it was fine, and an unassessed row
 * wearing green is the exact claim the evidence does not support. Only the
 * states that are themselves a statement get a colour - paused, finished,
 * abandoned.
 */
const STATUS_TONE: Record<string, string> = {
  active: 'var(--line-2)',
  planned: 'var(--line-2)',
  paused: 'var(--c2)',
  completed: 'var(--c1)',
  canceled: 'var(--ended)',
}

const PROJECT_STATUS = [
  { value: 'planned', label: 'Planned' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'completed', label: 'Completed' },
  { value: 'canceled', label: 'Canceled' },
]

const WORKSTREAM_STATUS = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'planned', label: 'Planned' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'paused', label: 'Paused' },
  { value: 'completed', label: 'Completed' },
  { value: 'canceled', label: 'Canceled' },
]

const PRIORITY = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: 'no_priority', label: 'None' },
]

const STATUS_WORD = new Map([...PROJECT_STATUS, ...WORKSTREAM_STATUS].map((s) => [s.value, s.label]))

export function ProjectList({
  rows,
  people,
  sort,
}: {
  rows: ProjectRow[]
  people: { id: string; name: string }[]
  /** The sort the page applied; 'custom' is the one you can drag under. */
  sort: string
}) {
  const [find, setFind] = useState('')
  const [showEnded, setShowEnded] = useState(false)

  const shown = useMemo(() => {
    const q = find.trim().toLowerCase()
    return rows.filter((r) => {
      if (!showEnded && ENDED.has(r.status)) return false
      if (!q) return true
      // A workstream's name counts as part of its project's, because people
      // look for the work they know the name of, not the container it
      // happens to sit in.
      return (
        r.name.toLowerCase().includes(q) ||
        (r.owner ?? '').toLowerCase().includes(q) ||
        r.workstreams.some((w) => w.name.toLowerCase().includes(q))
      )
    })
  }, [rows, find, showEnded])

  const hidden = rows.length - shown.length

  return (
    <>
      <div className="filters">
        <label className="fpill">
          <span>
            <span className="lab">Find</span>
            <input
              className="ffind"
              type="search"
              value={find}
              onChange={(e) => setFind(e.target.value)}
              placeholder="Project, owner or a workstream in it"
              aria-label="Find a project"
            />
          </span>
        </label>
        <label className={`fpill${showEnded ? ' active' : ''}`}>
          <span>
            <span className="lab">Showing</span>
            <select
              className="fsel"
              value={showEnded ? 'all' : 'live'}
              onChange={(e) => setShowEnded(e.target.value === 'all')}
              aria-label="Which projects to show"
            >
              <option value="live">Live only</option>
              <option value="all">Closed and canceled too</option>
            </select>
          </span>
        </label>
        <SortPicker sort={sort} />
      </div>

      {shown.length === 0 ? (
        <div className="blank">
          <h2>{find ? 'Nothing matches' : 'No projects yet'}</h2>
          <p>
            {find
              ? `No project, owner or workstream matches "${find}".`
              : 'Projects arrive from the sync, or are created on the Initiatives page.'}
          </p>
        </div>
      ) : (
        <div className="ilist">
          <SortableRows
            ids={shown.map((r) => r.id)}
            level="project"
            draggable={sort === 'custom'}
            render={(id) => {
            const r = shown.find((x) => x.id === id)!
            const edge =
              edgeColor(r.health, (r.next?.expected ?? 0) - (r.next?.pct ?? 0), r.rag) ??
              STATUS_TONE[r.status] ??
              'var(--line-2)'
            return (
              <div key={r.id} className="irow" style={{ borderLeftColor: edge }}>
                <div className="ir-ring">
                  {r.next && r.health ? (
                    <NextMilestoneRing pct={r.next.pct} expected={r.next.expected} health={r.health} />
                  ) : (
                    <span className="ir-noring" title="No milestone recorded">
                      –
                    </span>
                  )}
                  {r.next && (
                    <>
                      <span className="ir-short" title={r.next.name}>
                        {shortMilestone(r.next.name)}
                      </span>
                      <span className="ir-due">{r.next.due ?? 'no date'}</span>
                    </>
                  )}
                </div>

                <div className="ir-body">
                  <div className="ir-top">
                    <Link href={`/projects/${r.id}`} className="ir-name">
                      {r.name}
                    </Link>
                    <Editable
                      level="project"
                      id={r.id}
                      field="status"
                      kind="choice"
                      options={PROJECT_STATUS}
                      raw={r.status}
                      value={STATUS_WORD.get(r.status) ?? r.status}
                      className="ir-status-ed"
                    />
                    <span className="ir-meta">
                      {r.workstreams.length} workstream{r.workstreams.length === 1 ? '' : 's'}
                    </span>
                  </div>

                  <div className="ir-facts">
                    <span>
                      <i>Owner</i>
                      <Editable
                        level="project"
                        id={r.id}
                        field="owner"
                        kind="person"
                        people={people}
                        value={r.owner}
                        prompt="no owner"
                      />
                    </span>
                    <span>
                      <i>Dates</i>
                      <Editable
                        level="project"
                        id={r.id}
                        field="startDate"
                        kind="date"
                        raw={r.startDate}
                        value={calendarDate(r.startDate, { year: false })}
                        prompt="no start"
                      />
                      <em>→</em>
                      <Editable
                        level="project"
                        id={r.id}
                        field="targetDate"
                        kind="date"
                        raw={r.targetDate}
                        value={calendarDate(r.targetDate, { year: false })}
                        prompt="no target"
                      />
                      {r.datesRolledUp && <b title="Nobody typed these; they are the span of the workstreams.">rolled up</b>}
                    </span>
                  </div>

                  {r.next && <p className="ir-next">Next: {r.next.name}</p>}

                  {r.workstreams.length === 0 ? (
                    <p className="ir-desc">
                      Nothing in delivery yet — no workstreams roll up to this. That is a statement
                      about the plan, not a missing row.
                    </p>
                  ) : (
                    <WorkstreamTable rows={r.workstreams} people={people} />
                  )}
                </div>
              </div>
            )
            }}
          />
        </div>
      )}

      {hidden > 0 && !showEnded && (
        <p className="ir-hidden">
          {hidden} closed or canceled {hidden === 1 ? 'project is' : 'projects are'} hidden.
        </p>
      )}
    </>
  )
}

/**
 * The delivery work under one project.
 *
 * WHY THE COLUMNS ARE DECLARED AND THE LAYOUT IS FIXED
 *
 * The old table let the browser size its columns from the content, and the
 * health badge sat inside the name cell. A badge reading "Needs input" is
 * three times the width of one reading "On track", so the first column's
 * width — and with it every heading to its right — moved depending on which
 * rows happened to be unassessed. Health has a column of its own now, and
 * `table-layout: fixed` with a declared `<colgroup>` means the headings are
 * positioned by the colgroup and not by whatever is in the cells.
 */
function WorkstreamTable({
  rows,
  people,
}: {
  rows: WorkstreamRow[]
  people: { id: string; name: string }[]
}) {
  return (
    <div className="scroll-x">
      <table className="dtable cols">
        <colgroup>
          <col style={{ width: 118 }} />
          <col />
          <col style={{ width: 116 }} />
          <col style={{ width: 84 }} />
          <col style={{ width: 128 }} />
          <col style={{ width: 132 }} />
          <col style={{ width: 168 }} />
        </colgroup>
        <thead>
          <tr>
            <th>Health</th>
            <th>Workstream</th>
            <th>Status</th>
            <th>Priority</th>
            <th>Progress</th>
            <th>Lead</th>
            <th>Dates</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((w) => (
            <tr key={w.id}>
              <td>
                <HealthEditable
                  level="workstream"
                  id={w.id}
                  rag={w.health.rag}
                  rationale={w.health.rationale}
                  evidence={w.health.evidence}
                  origin={w.health.origin}
                />
              </td>
              <td>
                <Link href={`/workstreams/${w.id}`} className="ws-name">
                  {w.name}
                </Link>
              </td>
              <td>
                <Editable
                  level="workstream"
                  id={w.id}
                  field="status"
                  kind="choice"
                  options={WORKSTREAM_STATUS}
                  raw={w.status}
                  value={STATUS_WORD.get(w.status) ?? w.status}
                />
              </td>
              <td>
                <Editable
                  level="workstream"
                  id={w.id}
                  field="priority"
                  kind="choice"
                  options={PRIORITY}
                  raw={w.priority ?? 'medium'}
                  value={w.priority ? (PRIORITY.find((p) => p.value === w.priority)?.label ?? w.priority) : null}
                  prompt="unset"
                />
              </td>
              <td>
                <Editable
                  level="workstream"
                  id={w.id}
                  field="progress"
                  kind="number"
                  raw={String(Math.round(w.progress))}
                  value={`${Math.round(w.progress)}%`}
                  after={
                    <span className="wsbar" aria-hidden="true">
                      <span style={{ width: `${Math.max(0, Math.min(100, w.progress))}%` }} />
                    </span>
                  }
                />
              </td>
              <td>
                <Editable
                  level="workstream"
                  id={w.id}
                  field="lead"
                  kind="person"
                  people={people}
                  value={w.lead}
                  prompt="no lead"
                />
              </td>
              <td className="tabular-nums">
                <Editable
                  level="workstream"
                  id={w.id}
                  field="startDate"
                  kind="date"
                  raw={w.startDate}
                  value={calendarDate(w.startDate, { year: false })}
                  prompt="—"
                />
                <em className="arrow">→</em>
                <Editable
                  level="workstream"
                  id={w.id}
                  field="targetDate"
                  kind="date"
                  raw={w.targetDate}
                  value={calendarDate(w.targetDate, { year: false })}
                  prompt="—"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
