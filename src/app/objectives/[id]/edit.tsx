'use client'

/**
 * Renaming an objective, and ending one.
 *
 * There is no delete. An objective that is over is `completed` or `canceled`
 * and stops appearing on the home board; deleting it would take its changelog
 * with it, and the changelog is the only record of why a set of initiatives was
 * ever grouped this way.
 */
import { useActionState } from 'react'
import { editObjective, type GroupState } from '../actions'

const EMPTY: GroupState = {}

export function EditObjective({
  objective,
}: {
  objective: { id: string; name: string; description: string; status: string }
}) {
  const [state, act, busy] = useActionState(editObjective, EMPTY)

  return (
    <form action={act} className="group-form">
      <input type="hidden" name="id" value={objective.id} />
      <div className="gf-fields">
        <label>
          <span>Name</span>
          <input name="name" defaultValue={objective.name} required minLength={3} maxLength={200} />
        </label>
        <label>
          <span>What it is</span>
          <input name="description" defaultValue={objective.description} maxLength={500} />
        </label>
        <label>
          <span>Status</span>
          <select name="status" defaultValue={objective.status}>
            <option value="active">active</option>
            <option value="paused">paused</option>
            <option value="completed">completed</option>
            <option value="canceled">canceled</option>
          </select>
        </label>
      </div>
      <div className="gf-foot">
        <button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        {state.error && <span className="err">{state.error}</span>}
        {state.ok && state.message && <span className="ok">{state.message}</span>}
      </div>
    </form>
  )
}
