'use client'

/**
 * Changing a blocker or a dependency, and removing one.
 *
 * WHY ONE COMPONENT FOR TWO REGISTERS ON FOUR SCREENS
 *
 * A blocker shows on the work's own page and on the Blockers page; a
 * dependency likewise. Before this, each of those screens offered a different
 * fragment of editing — a status select here, an "Against" picker there,
 * nothing at all on the detail tiles — so which corrections were possible
 * depended on which screen you happened to notice the mistake from. Writing a
 * second dialog for the second screen would have made that permanent.
 *
 * So there is one, it opens on what the database currently holds rather than
 * on what the page was rendered with, and both registers use it because they
 * differ in their fields and not in what editing a record IS.
 *
 * WHY DELETE IS BEHIND A SECOND PRESS AND NOT A CONFIRM DIALOG
 *
 * `window.confirm` blocks the page and is the one thing a reader dismisses
 * without reading. The button turns into its own confirmation in place, which
 * has to be aimed at a second time, and says what it is about to remove.
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  deleteRegisterEntry,
  editRegisterEntry,
  loadRegisterEntry,
  type EntryKind,
  type LoadedEntry,
  type RegisterState,
} from '@/app/register-actions'

export interface Named {
  id: string
  name: string
}

export interface EditContext {
  people: Named[]
  /** "type:id" and a label, grouped — initiatives, projects, workstreams, milestones. */
  endpoints: Array<{ value: string; label: string; group: string }>
}

const TITLE: Record<EntryKind, string> = {
  blocker: 'Edit blocker',
  decision: 'Edit decision',
  dependency: 'Edit dependency',
}

export function EditEntryButton({
  kind,
  id,
  ctx,
  label,
}: {
  kind: EntryKind
  id: string
  ctx: EditContext
  /** What this row says, for the button's hover and the delete confirmation. */
  label?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className="row-edit"
        onClick={() => setOpen(true)}
        title={TITLE[kind]}
        aria-label={label ? `${TITLE[kind]}: ${label}` : TITLE[kind]}
      >
        ✎
      </button>
      {open && <EditDialog kind={kind} id={id} ctx={ctx} label={label} onClose={() => setOpen(false)} />}
    </>
  )
}

function EditDialog({
  kind,
  id,
  ctx,
  label,
  onClose,
}: {
  kind: EntryKind
  id: string
  ctx: EditContext
  label?: string
  onClose: () => void
}) {
  const router = useRouter()
  const [entry, setEntry] = useState<LoadedEntry | null>(null)
  const [state, setState] = useState<RegisterState>({})
  const [busy, setBusy] = useState(false)
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    let alive = true
    loadRegisterEntry(kind, id)
      .then((got) => {
        if (!alive) return
        if ('error' in got) setState({ error: got.error })
        else setEntry(got)
      })
      .catch(() => alive && setState({ error: 'That could not be read.' }))
    return () => {
      alive = false
    }
  }, [kind, id])

  async function submit(form: FormData) {
    setBusy(true)
    const get = (k: string) => String(form.get(k) ?? '')
    const res = await editRegisterEntry(
      kind !== 'dependency'
        ? {
            kind,
            id,
            title: get('title'),
            body: get('body'),
            status: get('status'),
            category: get('category'),
            ownerId: get('ownerId'),
            dueBy: get('dueBy'),
            at: get('at'),
          }
        : {
            kind,
            id,
            from: get('from'),
            to: get('to'),
            depKind: get('depKind'),
            status: get('status'),
            criticality: get('criticality'),
            description: get('description'),
            dueDate: get('dueDate'),
            ownerId: get('ownerId'),
          },
    ).catch((): RegisterState => ({ error: 'That could not be saved.' }))
    setBusy(false)
    setState(res)
    if (res.ok) {
      router.refresh()
      onClose()
    }
  }

  async function remove() {
    setBusy(true)
    const res = await deleteRegisterEntry(kind, id).catch((): RegisterState => ({
      error: 'That could not be deleted.',
    }))
    setBusy(false)
    setState(res)
    if (res.ok) {
      router.refresh()
      onClose()
    }
  }

  // Only the work — a blocker is filed against a piece of work, never against
  // a milestone, though both come from the one endpoint list.
  const work = ctx.endpoints.filter((o) => !o.value.startsWith('milestone:'))
  const groupsOf = (list: typeof ctx.endpoints) => [...new Set(list.map((e) => e.group))]

  const picker = (
    field: string,
    list: typeof ctx.endpoints,
    value: string,
    blank: string | null,
    /** What this end is called, when the live list does not carry it. */
    current?: string,
  ) => (
    <select id={`ee-${field}`} name={field} defaultValue={value} required={blank === null}>
      {blank !== null ? <option value="">{blank}</option> : null}
      {/* A record can point at work that has since ended, and that is not a
          reason to silently move it: the current value is offered even when
          the live list no longer carries it. */}
      {value && !list.some((o) => o.value === value) ? (
        <option value={value}>{current ?? 'What it points at now'}</option>
      ) : null}
      {groupsOf(list).map((g) => (
        <optgroup key={g} label={g}>
          {list
            .filter((o) => o.group === g)
            .map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  )

  return (
    <div className="modal-scrim" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={TITLE[kind]}>
        <div className="modal-head">
          <h3>
            {TITLE[kind]}
            {entry?.ref ? <span className="modal-ref">{entry.ref}</span> : null}
          </h3>
          <button type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {!entry ? (
          <p className="mr-hint">{state.error ?? 'Reading it…'}</p>
        ) : (
          <form action={submit}>
            {kind !== 'dependency' ? (
              <>
                <label className="mr-label" htmlFor="ee-title">
                  {kind === 'decision' ? 'What has to be decided' : 'What is blocked'}
                </label>
                <input id="ee-title" name="title" required defaultValue={entry.title ?? ''} />

                <label className="mr-label" htmlFor="ee-body">
                  {kind === 'decision' ? 'What the options are' : 'What is in the way'}
                </label>
                <input id="ee-body" name="body" required defaultValue={entry.body ?? ''} />

                <label className="mr-label" htmlFor="ee-at">
                  Against
                </label>
                {picker('at', work, entry.at ?? '', '— nothing in particular —', entry.atLabel)}

                <div className="mr-grid">
                  <span>
                    <label className="mr-label" htmlFor="ee-status">
                      Status
                    </label>
                    <select id="ee-status" name="status" defaultValue={entry.status}>
                      <option value="open">Open</option>
                      <option value="watch">Watching</option>
                      <option value="decided">{kind === 'decision' ? 'Decided' : 'Resolved'}</option>
                      <option value="dropped">Dropped</option>
                    </select>
                  </span>
                  <span>
                    <label className="mr-label" htmlFor="ee-cat">
                      Category
                    </label>
                    <select id="ee-cat" name="category" defaultValue={entry.category ?? 'delivery'}>
                      <option value="delivery">Delivery</option>
                      <option value="strategic">Strategic</option>
                      <option value="risk">Risk</option>
                    </select>
                  </span>
                  <span>
                    <label className="mr-label" htmlFor="ee-owner">
                      Owner
                    </label>
                    <select id="ee-owner" name="ownerId" defaultValue={entry.ownerId ?? ''}>
                      <option value="">— nobody named —</option>
                      {ctx.people.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </span>
                </div>

                {/* Free text on purpose: "next leads", "~7/10", "this week" is
                    what people say, and a date picker invents a precision they
                    do not have. */}
                <label className="mr-label" htmlFor="ee-dueby">
                  Needed by
                </label>
                <input id="ee-dueby" name="dueBy" defaultValue={entry.dueBy ?? ''} placeholder="next leads call" />
              </>
            ) : (
              <>
                <label className="mr-label" htmlFor="ee-from">
                  Delivering — what has to land
                </label>
                {picker('from', ctx.endpoints, entry.from ?? '', null, entry.fromLabel)}

                <label className="mr-label" htmlFor="ee-to">
                  Waiting — what cannot move until it does
                </label>
                {picker('to', ctx.endpoints, entry.to ?? '', null, entry.toLabel)}

                <label className="mr-label" htmlFor="ee-due">
                  Required by — when the delivering end has to have landed
                </label>
                <input id="ee-due" type="date" name="dueDate" defaultValue={entry.dueDate ?? ''} />

                <div className="mr-grid">
                  <span>
                    <label className="mr-label" htmlFor="ee-dkind">
                      Kind
                    </label>
                    <select id="ee-dkind" name="depKind" defaultValue={entry.depKind ?? 'blocks'}>
                      <option value="blocks">Blocks</option>
                      <option value="informs">Informs</option>
                      <option value="shares_resource">Shares a resource</option>
                      <option value="related">Related</option>
                    </select>
                  </span>
                  <span>
                    <label className="mr-label" htmlFor="ee-dstatus">
                      Status
                    </label>
                    <select id="ee-dstatus" name="status" defaultValue={entry.status}>
                      <option value="open">Open</option>
                      <option value="at_risk">At risk</option>
                      <option value="resolved">Resolved</option>
                      <option value="accepted_risk">Accepted risk</option>
                    </select>
                  </span>
                  <span>
                    <label className="mr-label" htmlFor="ee-crit">
                      Criticality
                    </label>
                    <select id="ee-crit" name="criticality" defaultValue={entry.criticality ?? 'normal'}>
                      <option value="normal">Normal</option>
                      <option value="high">High</option>
                      <option value="critical">Critical</option>
                    </select>
                  </span>
                </div>

                <label className="mr-label" htmlFor="ee-downer">
                  Owner
                </label>
                <select id="ee-downer" name="ownerId" defaultValue={entry.ownerId ?? ''}>
                  <option value="">— nobody named —</option>
                  {ctx.people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>

                <label className="mr-label" htmlFor="ee-desc">
                  Notes
                </label>
                <input id="ee-desc" name="description" defaultValue={entry.description ?? ''} />
              </>
            )}

            <div className="mr-row">
              <button type="submit" className="mr-go" disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </button>

              {armed ? (
                <>
                  <button type="button" className="mr-danger" disabled={busy} onClick={remove}>
                    {busy ? 'Deleting…' : 'Delete for good'}
                  </button>
                  <button type="button" className="mr-quiet" disabled={busy} onClick={() => setArmed(false)}>
                    Keep it
                  </button>
                </>
              ) : (
                <button type="button" className="mr-quiet" disabled={busy} onClick={() => setArmed(true)}>
                  Delete
                </button>
              )}

              {state.error ? <span className="mr-said mr-bad">{state.error}</span> : null}
            </div>

            {armed ? (
              <p className="mr-hint">
                Deleting <b>{label ?? 'this entry'}</b>. This removes the row itself. The change log keeps what it said, but nothing else does — if it
                was real and is simply over, <b>Dropped</b> or <b>Resolved</b> is the honest answer. And Yaara
                can file it again as a new entry if she reads about it in another document.
              </p>
            ) : null}
          </form>
        )}
      </div>
    </div>
  )
}
