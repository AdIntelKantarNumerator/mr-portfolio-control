'use client'

/**
 * Yaara's grouping proposals, with the two buttons that resolve them.
 *
 * Her proposed name sits in an editable field rather than plain text, because
 * the name is the part she is least likely to get right — she can see which
 * projects move together, not what the room calls the thing they add up to.
 */
import { useActionState } from 'react'
import { acceptSuggestion, dismissSuggestion, type GroupState } from './actions'

const EMPTY: GroupState = {}

export interface Suggestion {
  id: string
  name: string
  rationale: string | null
  agent: string
  projects: { id: string; name: string | null; grouped: string | null }[]
}

function One({ s }: { s: Suggestion }) {
  const [accepted, accept, accepting] = useActionState(acceptSuggestion, EMPTY)
  const [dismissed, dismiss, dismissing] = useActionState(dismissSuggestion, EMPTY)
  const state = accepted.error || accepted.ok ? accepted : dismissed
  const busy = accepting || dismissing

  // Once either button has landed the row is gone from the next render; until
  // then the message is the only feedback, so it stays visible.
  const gone = Boolean(accepted.ok || dismissed.ok)

  return (
    <div className={`sugg${gone ? ' done' : ''}`}>
      <form action={accept} className="sg-main">
        <input type="hidden" name="id" value={s.id} />
        <div className="sg-head">
          <input name="name" defaultValue={s.name} maxLength={200} aria-label="Initiative name" disabled={busy} />
          <span className="sg-by">{s.agent} suggests</span>
        </div>

        {s.rationale && <p className="sg-why">{s.rationale}</p>}

        <div className="chips sg-chips">
          {s.projects.map((p) => (
            <span key={p.id} className={p.name ? '' : 'missing'}>
              {p.name ?? 'a project that no longer exists'}
              {p.grouped && <span className="w">now in {p.grouped}</span>}
            </span>
          ))}
        </div>

        <div className="sg-foot">
          <button type="submit" disabled={busy || gone}>
            {accepting ? 'Creating…' : 'Create this initiative'}
          </button>
        </div>
      </form>

      <form action={dismiss} className="sg-no">
        <input type="hidden" name="id" value={s.id} />
        <button type="submit" disabled={busy || gone}>
          {dismissing ? 'Dismissing…' : 'No'}
        </button>
      </form>

      {state.error && <p className="sg-msg err">{state.error}</p>}
      {state.ok && state.message && <p className="sg-msg ok">{state.message}</p>}
    </div>
  )
}

export function Suggestions({ suggestions }: { suggestions: Suggestion[] }) {
  if (suggestions.length === 0) return null
  return (
    <section className="suggs">
      <div className="sh">
        <h2>Groupings she noticed</h2>
        <span className="status quiet">{suggestions.length} waiting</span>
      </div>
      <p className="lead">
        Proposals, not changes. Nothing moves until somebody here says so, and a set you say no to is not offered
        again.
      </p>
      {suggestions.map((s) => (
        <One key={s.id} s={s} />
      ))}
    </section>
  )
}
