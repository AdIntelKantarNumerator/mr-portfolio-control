'use client'

/**
 * Renaming an initiative, and ending one.
 *
 * There is no delete. An initiative that is over is `completed` or `canceled`
 * and stops appearing on the home board; deleting it would take its changelog
 * with it, and the changelog is the only record of why a set of projects was
 * ever grouped this way.
 */
import { useActionState } from 'react'
import { editInitiative, type GroupState } from '../actions'

const EMPTY: GroupState = {}

export function EditInitiative({
  initiative,
}: {
  initiative: { id: string; name: string; description: string; status: string }
}) {
  const [state, act, busy] = useActionState(editInitiative, EMPTY)

  return (
    <form action={act} className="group-form">
      <input type="hidden" name="id" value={initiative.id} />
      <div className="gf-fields">
        <label>
          <span>Name</span>
          <input name="name" defaultValue={initiative.name} required minLength={3} maxLength={200} />
        </label>
        <label>
          <span>What it is</span>
          <input name="description" defaultValue={initiative.description} maxLength={500} />
        </label>
        <label>
          <span>Status</span>
          <select name="status" defaultValue={initiative.status}>
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
