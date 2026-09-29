'use client'

/**
 * The initiatives themselves, with a find box, a filter and the editing
 * machinery folded away.
 *
 * The create/move form used to sit above the list, so getting to the thing
 * you came for meant scrolling past a control you use once a month. It is
 * collapsed now, and the list is the page.
 */
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { SortableRows, SortPicker } from '@/components/sortable-rows'
import { HealthDot } from '@/components/health-state'
import { edgeColor } from '@/lib/card-health'
import { Grouping } from './grouping'

export interface InitiativeRow {
  id: string
  name: string
  description: string | null
  status: string
  owner: string | null
  projects: { id: string; name: string; workstreams: number }[]
  workstreamCount: number
  /** From the home board, so the ring and the border mean the same thing there. */
  health: 'good' | 'warn' | 'crit' | 'quiet' | null
  /** Why the row reads the way it does. See lib/card-health.ts. */
  reasons: { text: string; tone: 'crit' | 'warn' | 'muted' }[]
}

const ENDED = new Set(['completed', 'canceled', 'cancelled', 'withdrawn'])

/* The edge for an unassessed row is neutral, not green: see the note in
   projects/list.tsx. The word itself still gets its colour in `.ir-status`. */
const EDGE_TONE: Record<string, string> = {
  paused: 'var(--c2)',
  completed: 'var(--c1)',
  canceled: 'var(--ended)',
  withdrawn: 'var(--ended)',
}

const STATUS_TONE: Record<string, string> = {
  active: 'var(--c5)',
  paused: 'var(--c2)',
  completed: 'var(--c1)',
  canceled: 'var(--ended)',
  withdrawn: 'var(--ended)',
}

export function InitiativeList({
  rows,
  loose,
  options,
  sort,
}: {
  rows: InitiativeRow[]
  /** The sort the page applied; 'custom' is the one you can drag under. */
  sort: string
  loose: { id: string; name: string; workstreams: number }[]
  options: { id: string; name: string; initiativeId: string | null; workstreams: number }[]
}) {
  const [find, setFind] = useState('')
  const [showEnded, setShowEnded] = useState(false)
  const [editing, setEditing] = useState(false)

  const shown = useMemo(() => {
    const q = find.trim().toLowerCase()
    return rows.filter((r) => {
      if (!showEnded && ENDED.has(r.status)) return false
      if (!q) return true
      // The projects inside count as part of an initiative's name for finding
      // purposes: people look for an initiative by something they know is in
      // it far more often than by what somebody called the grouping.
      return (
        r.name.toLowerCase().includes(q) ||
        (r.description ?? '').toLowerCase().includes(q) ||
        r.projects.some((p) => p.name.toLowerCase().includes(q))
      )
    })
  }, [rows, find, showEnded])

  const hiddenByFilter = rows.length - shown.length

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
              placeholder="Initiative or a project in it"
              aria-label="Find an initiative"
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
              aria-label="Which initiatives to show"
            >
              <option value="live">Live only</option>
              <option value="all">Closed and withdrawn too</option>
            </select>
          </span>
        </label>
        {/* A button, not a filter pill: it does not narrow what you are
            looking at, it opens a form. Wearing the same chrome as Find and
            Showing said otherwise, and it sits on the right because it acts
            on the page rather than describing it. */}
        <button
          type="button"
          className={`btn-primary push-right${editing ? ' on' : ''}`}
          onClick={() => setEditing(!editing)}
          aria-expanded={editing}
        >
          {editing ? 'Close' : 'Edit Initiatives'}
        </button>
        <SortPicker sort={sort} />
      </div>

      {editing && <Grouping initiatives={rows.map((r) => ({ id: r.id, name: r.name }))} projects={options} />}

      {shown.length === 0 ? (
        <div className="blank">
          <h2>{find ? 'Nothing matches' : 'No initiatives yet'}</h2>
          <p>
            {find
              ? `No initiative, description or project matches "${find}".`
              : 'Open Edit initiatives above to create one, or ask Yaara which projects belong together.'}
          </p>
        </div>
      ) : (
        <div className="ilist">
          <SortableRows
            ids={shown.map((r) => r.id)}
            level="initiative"
            draggable={sort === 'custom'}
            render={(id) => {
            const r = shown.find((x) => x.id === id)!
            const edge =
              edgeColor(r.health) ??
              EDGE_TONE[r.status] ??
              'var(--line-2)'
            return (
              <div key={r.id} className="irow" style={{ borderLeftColor: edge }}>
                <div className="ir-ring">
                  <HealthDot health={r.health} reasons={r.reasons} />
                </div>

                <div className="ir-body">
                  <div className="ir-top">
                    <Link href={`/initiatives/${r.id}`} className="ir-name">
                      {r.name}
                    </Link>
                    <span className="ir-status" style={{ color: STATUS_TONE[r.status] ?? 'var(--muted)' }}>
                      {r.status}
                    </span>
                    <span className="ir-meta">
                      {r.projects.length} project{r.projects.length === 1 ? '' : 's'} · {r.workstreamCount} workstream
                      {r.workstreamCount === 1 ? '' : 's'}
                      {r.owner ? ` · ${r.owner}` : ''}
                    </span>
                  </div>

                  {r.description && <p className="ir-desc">{r.description}</p>}

                  {r.projects.length === 0 ? (
                    <p className="ir-desc">
                      Empty. An initiative with no projects is a card with nothing on it.
                    </p>
                  ) : (
                    <div className="chips">
                      {r.projects.map((p) => (
                        <Link key={p.id} href={`/projects/${p.id}`}>
                          {p.name}
                          <span className="w">{p.workstreams} WS</span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
            }}
          />
        </div>
      )}

      {hiddenByFilter > 0 && !showEnded && (
        <p className="ir-hidden">
          {hiddenByFilter} closed or withdrawn {hiddenByFilter === 1 ? 'initiative is' : 'initiatives are'} hidden.
        </p>
      )}

      {loose.length > 0 && (
        <div className="irow orphan-row" style={{ borderLeftColor: 'var(--crit)' }}>
          <div className="ir-ring">
            {/* Where the ring sits on every other row. Loose projects have no
                milestone to measure, and the thing worth saying about them is
                that they are loose. */}
            <span className="ir-bang" aria-hidden="true">
              !
            </span>
            <span className="ir-due">{loose.length} loose</span>
          </div>
          <div className="ir-body">
            <div className="ir-top">
              <strong className="ir-name">Not in an initiative</strong>
              <span className="ir-meta">
                Running, and on nobody&rsquo;s card — invisible to anyone reading the home page for a status.
              </span>
            </div>
            <div className="chips">
              {loose.map((p) => (
                <Link key={p.id} href={`/projects/${p.id}`}>
                  {p.name}
                  <span className="w">{p.workstreams} WS</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
