'use client'

/**
 * One action item, with the two repairs it usually needs.
 *
 * The edit panel is collapsed by default. A page of forty rows all showing an
 * owner dropdown and a date picker is a page nobody reads — the text and who
 * owes it is the information, and editing is the exception.
 */
import { useActionState, useState } from 'react'
import { claimAction, setActionStatus, type ActionState } from './actions'

const EMPTY: ActionState = {}

export interface ActionItemView {
  id: string
  ref: string | null
  text: string
  ownerId: string | null
  owner: string | null
  unowned: boolean
  due: string | null
  overdue: boolean
  status: string
  source: string | null
  sourceUrl: string | null
  author: string | null
  links: { level: string; id: string; name: string; href: string }[]
}

export function ActionRow({
  item,
  people,
}: {
  item: ActionItemView
  people: { id: string; name: string }[]
}) {
  const [open, setOpen] = useState(false)
  const [dropping, setDropping] = useState(false)
  const [statusState, changeStatus, changing] = useActionState(setActionStatus, EMPTY)
  const [editState, edit, editing] = useActionState(claimAction, EMPTY)
  const busy = changing || editing
  const state = statusState.error || statusState.ok ? statusState : editState

  const tone = item.overdue ? 'crit' : item.unowned ? 'warn' : ''

  return (
    <div className={`act${tone ? ` ${tone}` : ''}${item.status !== 'open' ? ' closed' : ''}`}>
      <div className="a-main">
        <div className="a-text">
          {item.ref && <span className="a-ref">{item.ref}</span>}
          <span>{item.text}</span>
        </div>
        <div className="a-meta">
          <span className={item.unowned ? 'a-gap' : ''}>{item.owner ?? 'nobody named'}</span>
          <span className={item.overdue ? 'a-gap' : ''}>
            {item.due ?? 'no date'}
            {item.overdue ? ' — overdue' : ''}
          </span>
          {item.links.map((l) => (
            <a key={`${l.level}:${l.id}`} href={l.href}>
              {l.name}
            </a>
          ))}
          {item.source && (
            <span className="a-src">
              from {item.sourceUrl ? <a href={item.sourceUrl}>{item.source}</a> : item.source}
              {item.author ? ` · read by ${item.author}` : ''}
            </span>
          )}
        </div>
      </div>

      <div className="a-do">
        {item.status === 'open' ? (
          <>
            <form action={changeStatus}>
              <input type="hidden" name="id" value={item.id} />
              <input type="hidden" name="status" value="done" />
              <button type="submit" disabled={busy} className="a-done">
                Done
              </button>
            </form>
            <button type="button" onClick={() => setOpen(!open)} disabled={busy} className="a-edit">
              {open ? 'Close' : 'Edit'}
            </button>
          </>
        ) : (
          <form action={changeStatus}>
            <input type="hidden" name="id" value={item.id} />
            <input type="hidden" name="status" value="open" />
            <span className="a-was">{item.status}</span>
            <button type="submit" disabled={busy} className="a-edit">
              Reopen
            </button>
          </form>
        )}
      </div>

      {open && (
        <div className="a-panel">
          <form action={edit} className="a-form">
            <input type="hidden" name="id" value={item.id} />
            <label>
              <span>Owner</span>
              <select name="ownerId" defaultValue={item.ownerId ?? ''}>
                <option value="">— nobody —</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Due</span>
              <input type="date" name="dueDate" defaultValue={item.due ?? ''} />
            </label>
            <button type="submit" disabled={busy}>
              Save
            </button>
          </form>

          {dropping ? (
            <form action={changeStatus} className="a-form">
              <input type="hidden" name="id" value={item.id} />
              <input type="hidden" name="status" value="dropped" />
              <label className="grow">
                <span>Why it is being dropped</span>
                <input name="note" required minLength={3} placeholder="Superseded by the vendor decision" />
              </label>
              <button type="submit" disabled={busy}>
                Drop it
              </button>
            </form>
          ) : (
            <button type="button" className="a-drop" onClick={() => setDropping(true)}>
              Drop this commitment instead
            </button>
          )}
        </div>
      )}

      {state.error && <p className="a-msg err">{state.error}</p>}
      {state.ok && state.message && <p className="a-msg ok">{state.message}</p>}
    </div>
  )
}
