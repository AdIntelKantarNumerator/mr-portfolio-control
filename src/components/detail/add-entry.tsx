'use client'

/**
 * The "+" on a register tile.
 *
 * WHY EACH TILE GETS ONE
 *
 * These four registers were read-only on this page. Everything in them was
 * written by Yaara out of a meeting she read, which covers most of what gets
 * said — and none of what gets said in a corridor, on a call she has no notes
 * for, or by somebody who simply noticed something. The page showed you a list
 * and gave you nowhere to add to it, so those things went into a notebook.
 *
 * The button is small and sits in the tile's header, because adding is the
 * exception: the list is what the tile is for.
 */
import { useState } from 'react'
import { addActionItem, addDependency, addRegisterEntry, type RegisterState } from '@/app/register-actions'

export type EntryKind = 'blocker' | 'decision' | 'action' | 'dependency'

export interface Named {
  id: string
  name: string
}

export interface AddContext {
  level: string
  entityId: string
  people: Named[]
  /** Everything a dependency could point at: "type:id" and a label. */
  endpoints: Array<{ value: string; label: string; group: string }>
}

const TITLE: Record<EntryKind, string> = {
  blocker: 'Raise a blocker',
  decision: 'Record a decision to make',
  action: 'Add an action item',
  dependency: 'Add a dependency',
}

export function AddEntry({ kind, ctx }: { kind: EntryKind; ctx: AddContext }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="tile-add" onClick={() => setOpen(true)} title={TITLE[kind]}>
        + Add
      </button>
      {open && <Dialog kind={kind} ctx={ctx} onClose={() => setOpen(false)} />}
    </>
  )
}

function Dialog({ kind, ctx, onClose }: { kind: EntryKind; ctx: AddContext; onClose: () => void }) {
  const [state, setState] = useState<RegisterState>({})
  const [busy, setBusy] = useState(false)

  async function submit(form: FormData) {
    setBusy(true)
    const get = (k: string) => String(form.get(k) ?? '')
    const res =
      kind === 'action'
        ? await addActionItem({
            level: ctx.level,
            entityId: ctx.entityId,
            text: get('text'),
            ownerId: get('ownerId'),
            dueDate: get('dueDate'),
          })
        : kind === 'dependency'
          ? await addDependency({
              level: ctx.level,
              entityId: ctx.entityId,
              direction: get('direction') === 'waiting' ? 'waiting' : 'delivering',
              other: get('other'),
              requiredBy: get('requiredBy'),
              criticality: get('criticality'),
              description: get('description'),
            })
          : await addRegisterEntry({
              kind,
              level: ctx.level,
              entityId: ctx.entityId,
              title: get('title'),
              body: get('body'),
              ownerId: get('ownerId'),
              dueBy: get('dueBy'),
            })
    setBusy(false)
    setState(res)
    // Closing on success rather than showing a tick: the new row is in the
    // tile behind the dialog, which is a better confirmation than a message.
    if (res.ok) onClose()
  }

  const groups = [...new Set(ctx.endpoints.map((e) => e.group))]

  return (
    <div className="modal-scrim" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={TITLE[kind]}>
        <div className="modal-head">
          <h3>{TITLE[kind]}</h3>
          <button type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <form action={submit}>
          {kind === 'action' ? (
            <>
              <label className="mr-label" htmlFor="ae-text">
                What somebody is going to do
              </label>
              <input id="ae-text" name="text" required placeholder="Send the revised decomposition to the sponsor" />

              <div className="mr-grid">
                <span>
                  <label className="mr-label" htmlFor="ae-owner">
                    Owner
                  </label>
                  <select id="ae-owner" name="ownerId" defaultValue="">
                    <option value="">— nobody named —</option>
                    {ctx.people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </span>
                <span>
                  <label className="mr-label" htmlFor="ae-due">
                    Due
                  </label>
                  <input id="ae-due" type="date" name="dueDate" />
                </span>
                <span />
              </div>
            </>
          ) : kind === 'dependency' ? (
            <>
              <label className="mr-label" htmlFor="ae-dir">
                This work is
              </label>
              <select id="ae-dir" name="direction" defaultValue="waiting">
                <option value="waiting">waiting on something else</option>
                <option value="delivering">what something else is waiting on</option>
              </select>

              <label className="mr-label" htmlFor="ae-other">
                The other end
              </label>
              <select id="ae-other" name="other" required defaultValue="">
                <option value="">Select…</option>
                {groups.map((g) => (
                  <optgroup key={g} label={g}>
                    {ctx.endpoints
                      .filter((o) => o.group === g)
                      .map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>

              <div className="mr-grid">
                <span>
                  <label className="mr-label" htmlFor="ae-req">
                    Required by
                  </label>
                  <input id="ae-req" type="date" name="requiredBy" />
                </span>
                <span>
                  <label className="mr-label" htmlFor="ae-crit">
                    Criticality
                  </label>
                  <select id="ae-crit" name="criticality" defaultValue="normal">
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </span>
                <span />
              </div>

              <label className="mr-label" htmlFor="ae-desc">
                Notes
              </label>
              <input id="ae-desc" name="description" placeholder="what was agreed, and where" />
              <p className="mr-hint">
                A required date is what makes this more than a note: the delivering work goes blocked when it is
                not going to make it.
              </p>
            </>
          ) : (
            <>
              <label className="mr-label" htmlFor="ae-title">
                {kind === 'blocker' ? 'What is blocked' : 'What has to be decided'}
              </label>
              <input
                id="ae-title"
                name="title"
                required
                placeholder={kind === 'blocker' ? 'Entitlements UI cannot start' : 'Which identifier wins'}
              />

              <label className="mr-label" htmlFor="ae-body">
                {kind === 'blocker' ? 'What is in the way' : 'What the options are'}
              </label>
              <input
                id="ae-body"
                name="body"
                required
                placeholder={kind === 'blocker' ? 'waiting on the entity rules decision' : 'legacy id, or the new one'}
              />

              <div className="mr-grid">
                <span>
                  <label className="mr-label" htmlFor="ae-owner2">
                    Owner
                  </label>
                  <select id="ae-owner2" name="ownerId" defaultValue="">
                    <option value="">— nobody named —</option>
                    {ctx.people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </span>
                <span>
                  {/* Free text: "next leads", "~7/10", "this week" is what
                      people say, and a date picker invents a precision they
                      do not have. */}
                  <label className="mr-label" htmlFor="ae-dueby">
                    Needed by
                  </label>
                  <input id="ae-dueby" name="dueBy" placeholder="next leads call" />
                </span>
                <span />
              </div>
            </>
          )}

          <div className="mr-row">
            <button type="submit" className="mr-go" disabled={busy}>
              {busy ? 'Saving…' : 'Add'}
            </button>
            {state.error ? <span className="mr-said mr-bad">{state.error}</span> : null}
          </div>
        </form>
      </div>
    </div>
  )
}
