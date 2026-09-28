'use client'

/**
 * Every workstream, in the same row shape as projects and initiatives.
 *
 * This is the flat view — the one you come to when you know the name of the
 * thing and not where it lives, which is the state a workstream converted
 * from intake is in on the day it is created. So the project it rolls up to
 * is shown on the row rather than being the way you navigate to it.
 *
 * The fields are editable here for the same reason they are on the Projects
 * page: this is where somebody notices that the lead left in March.
 */
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { NextMilestoneRing, edgeColor, shortMilestone } from '@/components/ring'
import { Editable } from '@/components/editable'
import { HealthEditable } from '@/components/health-editable'
import { calendarDate } from '@/lib/calendar-date'

export interface WsListRow {
  id: string
  name: string
  status: string
  priority: string | null
  progress: number
  lead: string | null
  team: string | null
  startDate: string | null
  targetDate: string | null
  project: { id: string; name: string } | null
  health: { rag: string; rationale: string | null; evidence: string | null; origin: string }
  pace: 'good' | 'warn' | 'crit' | 'quiet' | null
  next: { name: string; pct: number; expected: number; due: string | null } | null
}

const ENDED = new Set(['completed', 'canceled', 'cancelled', 'withdrawn'])

/** Live work first, then the not-yet-started, then everything finished. */
const STATUS_RANK: Record<string, number> = {
  in_progress: 0,
  paused: 1,
  planned: 2,
  backlog: 3,
  completed: 4,
  canceled: 5,
}

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
  in_progress: 'var(--line-2)',
  planned: 'var(--line-2)',
  backlog: 'var(--line-2)',
  paused: 'var(--c2)',
  completed: 'var(--c1)',
  canceled: 'var(--ended)',
}

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

const STATUS_WORD = new Map(WORKSTREAM_STATUS.map((s) => [s.value, s.label]))
const PRIORITY_WORD = new Map(PRIORITY.map((s) => [s.value, s.label]))

export function WorkstreamList({
  rows,
  people,
}: {
  rows: WsListRow[]
  people: { id: string; name: string }[]
}) {
  const [find, setFind] = useState('')
  const [showEnded, setShowEnded] = useState(false)
  const [loose, setLoose] = useState(false)

  const shown = useMemo(() => {
    const q = find.trim().toLowerCase()
    return rows
      .filter((r) => {
        if (!showEnded && ENDED.has(r.status)) return false
        if (loose && r.project) return false
        if (!q) return true
        return (
          r.name.toLowerCase().includes(q) ||
          (r.lead ?? '').toLowerCase().includes(q) ||
          (r.project?.name ?? '').toLowerCase().includes(q)
        )
      })
      .sort((a, b) => {
        const ra = STATUS_RANK[a.status] ?? 99
        const rb = STATUS_RANK[b.status] ?? 99
        if (ra !== rb) return ra - rb
        return a.name.localeCompare(b.name)
      })
  }, [rows, find, showEnded, loose])

  const orphans = rows.filter((r) => !r.project && !ENDED.has(r.status)).length
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
              placeholder="Workstream, lead or project"
              aria-label="Find a workstream"
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
              aria-label="Which workstreams to show"
            >
              <option value="live">Live only</option>
              <option value="all">Closed and canceled too</option>
            </select>
          </span>
        </label>
        {orphans > 0 && (
          <button type="button" className={`fpill as-btn${loose ? ' active' : ''}`} onClick={() => setLoose(!loose)}>
            <span>
              <span className="lab">Not under a project</span>
              <span className="val">
                {orphans} {loose ? '· showing only these' : '· show'}
              </span>
            </span>
          </button>
        )}
      </div>

      {shown.length === 0 ? (
        <div className="blank">
          <h2>{find ? 'Nothing matches' : 'No workstreams yet'}</h2>
          <p>
            {find
              ? `No workstream, lead or project matches "${find}".`
              : 'Workstreams arrive from the sync, or are converted from an intake request.'}
          </p>
        </div>
      ) : (
        <div className="ilist">
          {shown.map((r) => {
            const edge =
              edgeColor(r.pace, (r.next?.expected ?? 0) - (r.next?.pct ?? 0), r.health.rag) ??
              STATUS_TONE[r.status] ??
              'var(--line-2)'
            return (
              <div key={r.id} className="irow" style={{ borderLeftColor: edge }}>
                <div className="ir-ring">
                  {r.next && r.pace ? (
                    <NextMilestoneRing pct={r.next.pct} expected={r.next.expected} health={r.pace} />
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
                    <Link href={`/workstreams/${r.id}`} className="ir-name">
                      {r.name}
                    </Link>
                    <Editable
                      level="workstream"
                      id={r.id}
                      field="status"
                      kind="choice"
                      options={WORKSTREAM_STATUS}
                      raw={r.status}
                      value={STATUS_WORD.get(r.status) ?? r.status}
                      className="ir-status-ed"
                    />
                    <HealthEditable
                      level="workstream"
                      id={r.id}
                      rag={r.health.rag}
                      rationale={r.health.rationale}
                      evidence={r.health.evidence}
                      origin={r.health.origin}
                    />
                    {r.project ? (
                      <Link href={`/projects/${r.project.id}`} className="ir-meta">
                        {r.project.name}
                      </Link>
                    ) : (
                      <span
                        className="ir-loose"
                        title="Not under any project. Newly converted intake requests start this way."
                      >
                        no project
                      </span>
                    )}
                  </div>

                  <div className="ir-facts">
                    <span>
                      <i>Lead</i>
                      <Editable
                        level="workstream"
                        id={r.id}
                        field="lead"
                        kind="person"
                        people={people}
                        value={r.lead}
                        prompt="no lead"
                      />
                    </span>
                    <span>
                      <i>Priority</i>
                      <Editable
                        level="workstream"
                        id={r.id}
                        field="priority"
                        kind="choice"
                        options={PRIORITY}
                        raw={r.priority ?? 'medium'}
                        value={r.priority ? (PRIORITY_WORD.get(r.priority) ?? r.priority) : null}
                        prompt="unset"
                      />
                    </span>
                    <span>
                      <i>Progress</i>
                      <Editable
                        level="workstream"
                        id={r.id}
                        field="progress"
                        kind="number"
                        raw={String(Math.round(r.progress))}
                        value={`${Math.round(r.progress)}%`}
                        after={
                          <span className="wsbar" aria-hidden="true">
                            <span style={{ width: `${Math.max(0, Math.min(100, r.progress))}%` }} />
                          </span>
                        }
                      />
                    </span>
                    <span>
                      <i>Dates</i>
                      <Editable
                        level="workstream"
                        id={r.id}
                        field="startDate"
                        kind="date"
                        raw={r.startDate}
                        value={calendarDate(r.startDate, { year: false })}
                        prompt="no start"
                      />
                      <em>→</em>
                      <Editable
                        level="workstream"
                        id={r.id}
                        field="targetDate"
                        kind="date"
                        raw={r.targetDate}
                        value={calendarDate(r.targetDate, { year: false })}
                        prompt="no target"
                      />
                    </span>
                    {r.team && (
                      <span>
                        <i>Team</i>
                        {r.team}
                      </span>
                    )}
                  </div>

                  {r.next && <p className="ir-next">Next: {r.next.name}</p>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {hidden > 0 && !showEnded && !loose && (
        <p className="ir-hidden">
          {hidden} closed or canceled {hidden === 1 ? 'workstream is' : 'workstreams are'} hidden.
        </p>
      )}
    </>
  )
}
