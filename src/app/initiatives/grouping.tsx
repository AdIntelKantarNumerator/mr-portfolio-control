'use client'

/**
 * The grouping form: create an initiative, or move projects into one.
 *
 * Both jobs are the same gesture — tick some projects, say where they go — so
 * they are one control with a mode switch rather than two forms that drift.
 * The tick list shows each project's current initiative, because the most
 * common mistake here is moving something that was already grouped and not
 * noticing.
 */
import { useActionState, useMemo, useState } from 'react'
import { assignProjects, createInitiative, type GroupState } from './actions'

interface ProjectOption {
  id: string
  name: string
  initiativeId: string | null
  workstreams: number
}

const EMPTY: GroupState = {}

export function Grouping({
  initiatives,
  projects,
}: {
  initiatives: { id: string; name: string }[]
  projects: ProjectOption[]
}) {
  const [mode, setMode] = useState<'create' | 'move'>(initiatives.length === 0 ? 'create' : 'move')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')

  const [createState, doCreate, creating] = useActionState(createInitiative, EMPTY)
  const [moveState, doMove, moving] = useActionState(assignProjects, EMPTY)
  const state = mode === 'create' ? createState : moveState
  const busy = creating || moving

  // Clear the ticks once a save lands. Without this the next submit silently
  // reuses the last selection, which on this screen means moving projects
  // nobody chose. Adjusted during render rather than in an effect: React
  // re-renders before painting, so the stale ticks are never shown, and an
  // effect would set state after paint (and is what the lint rule forbids).
  const [seen, setSeen] = useState(state.stamp)
  if (state.stamp !== seen) {
    setSeen(state.stamp)
    if (picked.size > 0) setPicked(new Set())
  }

  const nameOf = useMemo(() => new Map(initiatives.map((i) => [i.id, i.name])), [initiatives])
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q ? projects.filter((p) => p.name.toLowerCase().includes(q)) : projects
  }, [projects, filter])

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <form action={mode === 'create' ? doCreate : doMove} className="group-form">
      <div className="gf-modes">
        <button type="button" className={mode === 'create' ? 'on' : ''} onClick={() => setMode('create')}>
          New initiative
        </button>
        <button
          type="button"
          className={mode === 'move' ? 'on' : ''}
          onClick={() => setMode('move')}
          disabled={initiatives.length === 0}
        >
          Move projects
        </button>
      </div>

      {mode === 'create' ? (
        <div className="gf-fields" key={state.stamp ?? 0}>
          <label>
            <span>Name</span>
            <input name="name" required minLength={3} maxLength={200} placeholder="Ad Intelligence Platform" />
          </label>
          <label>
            <span>What it is (optional)</span>
            <input name="description" maxLength={500} placeholder="One line the room would recognise" />
          </label>
        </div>
      ) : (
        <div className="gf-fields">
          <label>
            <span>Move into</span>
            <select name="initiativeId" defaultValue="">
              <option value="">— remove from every initiative —</option>
              {initiatives.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div className="gf-pick">
        <div className="gf-pickhead">
          <strong>
            Projects{picked.size > 0 ? ` — ${picked.size} selected` : ''}
          </strong>
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by name"
            aria-label="Filter projects"
          />
        </div>
        <div className="gf-list">
          {shown.length === 0 ? (
            <p className="muted">No projects match.</p>
          ) : (
            shown.map((p) => (
              <label key={p.id} className={picked.has(p.id) ? 'on' : ''}>
                <input
                  type="checkbox"
                  name="projectIds"
                  value={p.id}
                  checked={picked.has(p.id)}
                  onChange={() => toggle(p.id)}
                />
                <span className="n">{p.name}</span>
                <span className="w">{p.workstreams} WS</span>
                <span className="i">{p.initiativeId ? (nameOf.get(p.initiativeId) ?? 'grouped') : 'ungrouped'}</span>
              </label>
            ))
          )}
        </div>
      </div>

      <div className="gf-foot">
        <button type="submit" disabled={busy || (mode === 'move' && picked.size === 0)}>
          {busy ? 'Saving…' : mode === 'create' ? 'Create initiative' : 'Move selected'}
        </button>
        {state.error && <span className="err">{state.error}</span>}
        {state.ok && state.message && <span className="ok">{state.message}</span>}
      </div>
    </form>
  )
}
