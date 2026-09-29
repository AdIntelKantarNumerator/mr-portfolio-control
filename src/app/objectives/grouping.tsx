'use client'

/**
 * The grouping form: create an objective, or move initiatives into one.
 *
 * Both jobs are the same gesture — tick some initiatives, say where they go — so
 * they are one control with a mode switch rather than two forms that drift.
 * The tick list shows each initiative's current objective, because the most
 * common mistake here is moving something that was already grouped and not
 * noticing.
 */
import { useActionState, useMemo, useState } from 'react'
import { assignInitiatives, createObjective, type GroupState } from './actions'

interface InitiativeOption {
  id: string
  name: string
  objectiveId: string | null
  projects: number
}

const EMPTY: GroupState = {}

export function Grouping({
  objectives,
  initiatives,
}: {
  objectives: { id: string; name: string }[]
  initiatives: InitiativeOption[]
}) {
  const [mode, setMode] = useState<'create' | 'move'>(objectives.length === 0 ? 'create' : 'move')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')

  const [createState, doCreate, creating] = useActionState(createObjective, EMPTY)
  const [moveState, doMove, moving] = useActionState(assignInitiatives, EMPTY)
  const state = mode === 'create' ? createState : moveState
  const busy = creating || moving

  // Clear the ticks once a save lands. Without this the next submit silently
  // reuses the last selection, which on this screen means moving initiatives
  // nobody chose. Adjusted during render rather than in an effect: React
  // re-renders before painting, so the stale ticks are never shown, and an
  // effect would set state after paint (and is what the lint rule forbids).
  const [seen, setSeen] = useState(state.stamp)
  if (state.stamp !== seen) {
    setSeen(state.stamp)
    if (picked.size > 0) setPicked(new Set())
  }

  const nameOf = useMemo(() => new Map(objectives.map((i) => [i.id, i.name])), [objectives])
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q ? initiatives.filter((p) => p.name.toLowerCase().includes(q)) : initiatives
  }, [initiatives, filter])

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
          New objective
        </button>
        <button
          type="button"
          className={mode === 'move' ? 'on' : ''}
          onClick={() => setMode('move')}
          disabled={objectives.length === 0}
        >
          Move initiatives
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
            <select name="objectiveId" defaultValue="">
              <option value="">— remove from every objective —</option>
              {objectives.map((i) => (
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
            Initiatives{picked.size > 0 ? ` — ${picked.size} selected` : ''}
          </strong>
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by name"
            aria-label="Filter initiatives"
          />
        </div>
        <div className="gf-list">
          {shown.length === 0 ? (
            <p className="muted">No initiatives match.</p>
          ) : (
            shown.map((p) => (
              <label key={p.id} className={picked.has(p.id) ? 'on' : ''}>
                <input
                  type="checkbox"
                  name="initiativeIds"
                  value={p.id}
                  checked={picked.has(p.id)}
                  onChange={() => toggle(p.id)}
                />
                <span className="n">{p.name}</span>
                <span className="w">{p.projects} WS</span>
                <span className="i">{p.objectiveId ? (nameOf.get(p.objectiveId) ?? 'grouped') : 'ungrouped'}</span>
              </label>
            ))
          )}
        </div>
      </div>

      <div className="gf-foot">
        <button type="submit" disabled={busy || (mode === 'move' && picked.size === 0)}>
          {busy ? 'Saving…' : mode === 'create' ? 'Create objective' : 'Move selected'}
        </button>
        {state.error && <span className="err">{state.error}</span>}
        {state.ok && state.message && <span className="ok">{state.message}</span>}
      </div>
    </form>
  )
}
